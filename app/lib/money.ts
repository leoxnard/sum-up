// All money is integer cents. No floats in the money path — floats appear only
// as exchange-rate multipliers, and every multiplication is rounded once.

export function formatCents(cents: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}

export function formatAmount(cents: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** Parse user input like "12,34", "12.34", "1.234,56" into cents. Null on garbage. */
export function parseAmountToCents(raw: string): number | null {
  let s = raw.trim().replace(/\s/g, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  // Whichever separator comes last is the decimal separator; the other is grouping.
  if (lastComma > lastDot) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma) {
    s = s.replace(/,/g, "");
  }
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

/** Convert original-currency cents to base-currency cents with the frozen rate. */
export function toBaseCents(cents: number, exchangeRate: number): number {
  return Math.round(cents * exchangeRate);
}

/**
 * Distribute `total` cents proportionally to `weights` using the largest-remainder
 * method. The result always sums exactly to `total`. Zero-weight positions get 0.
 */
export function distributeByWeights(total: number, weights: number[]): number[] {
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / weightSum);
  const floors = exact.map(Math.floor);
  let remainder = total - floors.reduce((a, b) => a + b, 0);
  // Hand out remaining cents to the largest fractional parts; ties resolve by index
  // so the same input always produces the same split.
  const order = exact
    .map((v, i) => ({ frac: v - Math.floor(v), i }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const result = [...floors];
  for (const { i } of order) {
    if (remainder <= 0) break;
    result[i] += 1;
    remainder -= 1;
  }
  return result;
}
