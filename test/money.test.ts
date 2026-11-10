import { describe, expect, it } from "vitest";
import { fromKop, parseRub, toKop } from "../src/utils/money.js";

describe("parseRub", () => {
  it("принимает число и строку с числом", () => {
    expect(parseRub(2500)).toBe(2500);
    expect(parseRub("2500.00")).toBe(2500);
    expect(parseRub(" 99 ")).toBe(99);
  });

  it("отклоняет мусор и отрицательные суммы", () => {
    expect(() => parseRub("abc")).toThrow();
    expect(() => parseRub(null)).toThrow();
    expect(() => parseRub(-1)).toThrow();
  });
});

describe("toKop / fromKop", () => {
  it("рубли в копейки", () => {
    expect(toKop(2500)).toBe(250000);
    expect(toKop(99)).toBe(9900);
  });

  it("отбрасывает доли копейки", () => {
    expect(toKop(10.999)).toBe(1099);
  });

  it.each([1.13, 0.29, 19.99, 4549.23])("не теряет копейку в %s", (rub) => {
    expect(toKop(rub)).toBe(Math.round(rub * 100));
    expect(toKop(String(rub))).toBe(Math.round(rub * 100));
  });

  it("сохраняет точность строк, десятичную экспоненту и отбрасывание долей", () => {
    expect(toKop("1.129999999999999999")).toBe(112);
    expect(toKop(" 4549.23 ")).toBe(454923);
    expect(toKop("1.13e2")).toBe(11300);
    expect(toKop(".29")).toBe(29);
    expect(toKop(1e-7)).toBe(0);
    expect(toKop("90071992547409.91")).toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each(["", "   ", "0x10", "abc", -1, Infinity, NaN, "90071992547409.92", 1e20])("отклоняет недопустимую сумму %s", (rub) => {
    expect(() => toKop(rub)).toThrow();
  });

  it("не возвращает неточную сумму при переполнении дневного итога", () => {
    expect(() => fromKop(Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });

  it("копейки в рубли", () => {
    expect(fromKop(250000)).toBe(2500);
    expect(fromKop(1099)).toBe(10.99);
  });
});
