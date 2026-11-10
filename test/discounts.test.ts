import { describe, expect, it } from "vitest";
import { apiOrder, dailyTotals, postWebhook, setupTestApp } from "./helpers.js";

const ctx = setupTestApp();

describe("скидки", () => {
  it("принимает старые заказы без обоих полей как заказы без скидки", async () => {
    const old = apiOrder({ amount: "19.99", discountPercent: undefined, amountPaid: undefined });
    expect((await postWebhook(ctx.app, old)).statusCode).toBe(200);
    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([{ date: "2026-02-10", total: 19.99, gross: 19.99, discount: 0, net: 19.99 }]);
  });

  it("суммирует 0%, 100%, дробный процент и использует amountPaid как источник оплаты", async () => {
    for (const over of [
      { amount: "1.13", discountPercent: "0", amountPaid: "1.13" },
      { amount: 100, discountPercent: 100, amountPaid: 0 },
      // Не пересчитываем процент: правила округления внешней системы нам неизвестны.
      { amount: 10, discountPercent: "12.5", amountPaid: "8.74" },
      { amount: 1000, discountPercent: 50, amountPaid: 500, status: "pending" },
      { amount: 1000, discountPercent: 50, amountPaid: 500, status: "refunded" },
    ]) expect((await postWebhook(ctx.app, apiOrder(over))).statusCode).toBe(200);
    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-11");
    expect(res.json()).toEqual([
      { date: "2026-02-10", total: 111.13, gross: 111.13, discount: 101.26, net: 9.87 },
      { date: "2026-02-11", total: 0, gross: 0, discount: 0, net: 0 },
    ]);
  });

  it.each([
    { discountPercent: -1 },
    { discountPercent: 101 },
    { discountPercent: "" },
    { discountPercent: "abc" },
    { discountPercent: null },
    { amountPaid: -0.01 },
    { amountPaid: 1000.01 },
    { amountPaid: "" },
    { amountPaid: undefined },
    { discountPercent: undefined },
  ])("не принимает некорректные поля %j", async (over) => {
    expect((await postWebhook(ctx.app, apiOrder(over))).statusCode).toBe(400);
  });

  it("sync считает невалидные скидки, обновляет все поля и не откатывает новую оплату", async () => {
    const order = apiOrder({ amount: 19.99, discountPercent: 0, amountPaid: 19.99 });
    await postWebhook(ctx.app, order);
    const fresh = { ...order, discountPercent: "10", amountPaid: "17.99", updatedAt: "2026-02-11T00:00:00Z" };
    ctx.api.pages.set(null, { items: [fresh, apiOrder({ discountPercent: "no" }), order], nextCursor: null });
    expect(await ctx.container.sync.run()).toMatchObject({ applied: 1, invalid: 1, stale: 1 });
    const { rows } = await ctx.db.query(`SELECT amount_paid_kop, discount_percent FROM orders WHERE id = $1`, [order.id]);
    expect(Number(rows[0].amount_paid_kop)).toBe(1799);
    expect(Number(rows[0].discount_percent)).toBe(10);
    expect((await postWebhook(ctx.app, { ...fresh, amountPaid: 0 })).json()).toEqual({ result: "stale" });
    expect((await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10")).json()).toEqual([
      { date: "2026-02-10", total: 19.99, gross: 19.99, discount: 2, net: 17.99 },
    ]);
  });
});
