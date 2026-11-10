import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrdersRepository } from "../src/repositories/orders.js";
import { toKop } from "../src/utils/money.js";
import { apiOrder, dailyTotals, postWebhook, setupTestApp } from "./helpers.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/c7.json", import.meta.url), "utf8")) as {
  customer: { id: string; timezone: string };
  orders: Record<string, unknown>[];
  webhooks: Record<string, unknown>[];
};
const ctx = setupTestApp();
afterEach(() => vi.useRealTimers());

describe("подтверждённые регрессии", () => {
  it("не теряет копейки реальных amountPaid", () => {
    expect([4549.23, 4099.44, 1276.1, 2284.99].map(toKop)).toEqual([454923, 409944, 127610, 228499]);
  });

  it("c_7 после синхронизации: исторический gross не зависит от текущего сезона", async () => {
    ctx.api.customers.set("c_7", fixture.customer.timezone);
    ctx.api.pages.set(null, { items: fixture.orders, nextCursor: null });
    expect((await ctx.container.sync.run()).invalid).toBe(0);
    vi.useFakeTimers({ toFake: ["Date"] });
    for (const now of ["2026-11-10T12:00:00Z", "2026-07-10T12:00:00Z"]) {
      vi.setSystemTime(new Date(now));
      const res = await dailyTotals(ctx.app, "c_7", "2026-03-27", "2026-03-31");
      expect(res.statusCode).toBe(200);
      expect(res.json().map((r: { total: number }) => r.total)).toEqual([24736, 47995, 49565, 59684, 40400]);
    }
  });

  it("репозиторий сам отвергает устаревшую запись после сохранения новой", async () => {
    const versions = fixture.webhooks.filter((o) => o.id === "o_02455");
    const fresh = versions.find((o) => o.updatedAt === "2026-03-31T03:28:24.000Z")!;
    const old = versions.find((o) => o.updatedAt === "2026-03-31T02:28:24.000Z")!;
    const repo = new OrdersRepository(ctx.db);
    await repo.save(ctx.container.orders.normalize(fresh));
    await repo.save(ctx.container.orders.normalize(old));
    expect((await repo.get("o_02455"))?.updatedAt.toISOString()).toBe(fresh.updatedAt);
  });

  it("c_7: все реальные вебхуки, повторы и обратный порядок дают одни итоги", async () => {
    ctx.api.customers.set("c_7", fixture.customer.timezone);
    ctx.api.pages.set(null, { items: fixture.orders, nextCursor: null });
    await ctx.container.sync.run();
    for (const order of [...fixture.webhooks].reverse()) {
      expect((await postWebhook(ctx.app, order)).statusCode).toBe(200);
    }
    const expected = [
      { date: "2026-03-27", total: 24736, gross: 24736, net: 19855.51, discount: 4880.49 },
      { date: "2026-03-28", total: 58233, gross: 58233, net: 54291.19, discount: 3941.81 },
      { date: "2026-03-29", total: 34658, gross: 34658, net: 31959.65, discount: 2698.35 },
      { date: "2026-03-30", total: 59684, gross: 59684, net: 49010.76, discount: 10673.24 },
      { date: "2026-03-31", total: 35401, gross: 35401, net: 29787.55, discount: 5613.45 },
    ];
    expect((await dailyTotals(ctx.app, "c_7", "2026-03-27", "2026-03-31")).json()).toEqual(expected);
    const responses = await Promise.all(fixture.webhooks.map((o) => postWebhook(ctx.app, o)));
    expect(responses.every((r) => r.json().result === "stale")).toBe(true);
    expect((await dailyTotals(ctx.app, "c_7", "2026-03-27", "2026-03-31")).json()).toEqual(expected);
  });

  it("конкурентное создание одинакового заказа даёт один created, остальные stale", async () => {
    const order = apiOrder();
    const responses = await Promise.all(Array.from({ length: 12 }, () => postWebhook(ctx.app, order)));
    expect(responses.map((r) => r.json().result).sort()).toEqual(["created", ...Array(11).fill("stale")]);
  });

  it("конкурентные реальные вебхуки и sync сохраняют максимальные версии, включая оплату", async () => {
    ctx.api.customers.set("c_7", fixture.customer.timezone);
    ctx.api.pages.set(null, { items: fixture.orders, nextCursor: null });
    await ctx.container.sync.run();
    await Promise.all([
      ctx.container.sync.run(),
      ...fixture.webhooks.map(async (o) => expect((await postWebhook(ctx.app, o)).statusCode).toBe(200)),
    ]);
    const latest = new Map(fixture.orders.map((o) => [o.id, o]));
    for (const o of fixture.webhooks) {
      if (String(o.updatedAt) > String(latest.get(o.id)!.updatedAt)) latest.set(o.id, o);
    }
    const { rows } = await ctx.db.query(`SELECT id, status, updated_at, amount_paid_kop FROM orders`);
    expect(rows).toHaveLength(fixture.orders.length);
    for (const row of rows) {
      const expected = latest.get(row.id)!;
      expect(row.updated_at.toISOString(), row.id).toBe(expected.updatedAt);
      expect(row.status, row.id).toBe(expected.status);
      // В этой реальной выборке входы имеют не более двух десятичных знаков.
      const paid = String(expected.amountPaid ?? expected.amount).split(".");
      const kop = BigInt(paid[0]) * 100n + BigInt((paid[1] ?? "").padEnd(2, "0"));
      expect(BigInt(row.amount_paid_kop), row.id).toBe(kop);
    }
  });

  it.each([
    ["2026-03-29", "2026-03-28T23:00:00.000Z", "2026-03-29T22:00:00.000Z"],
    ["2026-10-25", "2026-10-24T22:00:00.000Z", "2026-10-25T23:00:00.000Z"],
  ])("Berlin: день %s включает начало и исключает конец, независимо от длительности", async (day, start, end) => {
    ctx.api.customers.set("c_1", "Europe/Berlin");
    for (const [createdAt, amount] of [
      [new Date(Date.parse(start) - 1).toISOString(), 1000],
      [start, 1.13],
      [new Date(Date.parse(end) - 1).toISOString(), 0.29],
      [end, 2000],
    ] as const) {
      await postWebhook(ctx.app, apiOrder({ createdAt, amount }));
    }
    expect((await dailyTotals(ctx.app, "c_1", day, day)).json()).toEqual([
      { date: day, total: 1.42, gross: 1.42, discount: 0, net: 1.42 },
    ]);
  });
});
