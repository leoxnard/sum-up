import { describe, expect, it } from "vitest";
import { cleanAmountInput, distributeByWeights, parseAmountToCents, toBaseCents } from "./money";

describe("parseAmountToCents", () => {
  it.each([
    ["12,34", 1234],
    ["12.34", 1234],
    ["1.234,56", 123456],
    ["1,234.56", 123456],
    ["  7 ", 700],
    ["0.05", 5],
    ["1 234,50", 123450],
  ])("parses %j as %i cents", (input, expected) => {
    expect(parseAmountToCents(input)).toBe(expected);
  });

  it.each(["", "abc", "1.234.5", "12,345", "1,2,3", "€5", "1e3"])(
    "rejects %j",
    (input) => {
      expect(parseAmountToCents(input)).toBeNull();
    },
  );

  // Documented, deliberate: the parser is purely syntactic. Callers reject
  // non-positive amounts (EntryForm.validate, sync.server's bad_amount).
  it("returns negatives rather than rejecting them", () => {
    expect(parseAmountToCents("-5")).toBe(-500);
  });
});

describe("toBaseCents", () => {
  it("rounds exactly once", () => {
    expect(toBaseCents(1000, 1.0847)).toBe(1085);
    expect(toBaseCents(333, 0.5)).toBe(167); // .5 rounds up, not to even
  });

  it("is identity at rate 1", () => {
    expect(toBaseCents(12345, 1)).toBe(12345);
  });
});

describe("distributeByWeights", () => {
  it("splits 10.00 three ways with the remainder in front", () => {
    expect(distributeByWeights(1000, [1, 1, 1])).toEqual([334, 333, 333]);
  });

  it("gives zero-weight positions nothing", () => {
    expect(distributeByWeights(1000, [1, 0, 1])).toEqual([500, 0, 500]);
  });

  it("returns all zeros when every weight is zero", () => {
    expect(distributeByWeights(1000, [0, 0])).toEqual([0, 0]);
  });

  it("is deterministic for equal weights — ties break by index", () => {
    // 100/7 floors to 14 each (98), so the 2 leftover cents go to the first two.
    expect(distributeByWeights(100, [1, 1, 1, 1, 1, 1, 1])).toEqual([
      15, 15, 14, 14, 14, 14, 14,
    ]);
  });

  // The invariant the whole money path rests on.
  it("always sums exactly to the total", () => {
    let seed = 1;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let i = 0; i < 3000; i++) {
      const total = rand(1_000_000);
      const weights = Array.from({ length: 1 + rand(9) }, () => rand(100));
      const parts = distributeByWeights(total, weights);
      const sum = parts.reduce((a, b) => a + b, 0);
      if (weights.reduce((a, b) => a + b, 0) > 0) {
        expect(sum).toBe(total);
      } else {
        expect(sum).toBe(0);
      }
      expect(parts.every((p) => Number.isInteger(p) && p >= 0)).toBe(true);
    }
  });
});

describe("cleanAmountInput", () => {
  it.each([
    ["€ 12,50", "12,50"],
    ["12.50 EUR", "12.50"],
    ["-3,20 €", "-3,20"],
    ["CHF 1'234.50", "1234.50"],
    ["1 234,50 €", "1234,50"],
    ["Rechnung: 24,50", "24,50"],
    ["12,50.", "12,50"],
  ])("cleans %j to %j", (input, expected) => {
    expect(cleanAmountInput(input)).toBe(expected);
  });

  it("leaves text without a number alone", () => {
    expect(cleanAmountInput("  abc ")).toBe("abc");
  });

  it("produces something parseAmountToCents accepts", () => {
    expect(parseAmountToCents(cleanAmountInput("€ 1.234,56"))).toBe(123456);
  });
});
