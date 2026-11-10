/**
 * Деньги внутри сервиса — целые копейки. Рубли — только на входе (внешний API) и в ответах.
 */

const DECIMAL = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

/** Сумма из внешнего API: число или десятичная строка ("250.10"). */
export function parseRub(raw: unknown): number {
  if (typeof raw === "string" && !DECIMAL.test(raw.trim())) {
    throw new Error(`invalid amount: ${JSON.stringify(raw)}`);
  }
  const value = typeof raw === "string" ? Number(raw.trim()) : raw;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`invalid amount: ${JSON.stringify(raw)}`);
  }
  return value;
}

/** Рубли → копейки. Доли копейки отбрасываются: деньги клиенту не досчитываем. */
export function toKop(rub: number | string): number {
  parseRub(rub);
  // Не умножаем двоичный float. Строковый вход сохраняет исходную точность.
  const [coefficient, exponent = "0"] = String(rub).trim().toLowerCase().split("e");
  const [whole, fraction = ""] = coefficient.split(".");
  const digits = (whole + fraction).replace(/^0+/, "") || "0";
  if (digits === "0") return 0;
  const shift = Number(exponent) - fraction.length + 2;
  let integer: string;
  if (shift >= 0) {
    if (digits.length + shift > 16) throw new Error("amount exceeds safe integer kopecks");
    integer = digits + "0".repeat(shift);
  } else {
    integer = digits.slice(0, Math.max(0, digits.length + shift)) || "0";
  }
  const kop = Number(integer);
  if (!Number.isSafeInteger(kop)) throw new Error("amount exceeds safe integer kopecks");
  return kop;
}

/** Копейки → рубли для ответа API. */
export function fromKop(kop: number): number {
  if (!Number.isSafeInteger(kop)) throw new Error("total exceeds safe integer kopecks");
  return kop / 100;
}
