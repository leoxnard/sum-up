import { describe, expect, it } from "vitest";
import { computeShares, type SplitInput } from "./split";

const inputs = (...values: (number | null)[]): SplitInput[] =>
  values.map((value, i) => ({ memberId: `m${i}`, value, included: true }));

/** Shares must always sum to the expense amount — the ledger depends on it. */
const expectSumsTo = (result: ReturnType<typeof computeShares>, total: number) => {
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.shares.reduce((a, s) => a + s.shareCents, 0)).toBe(total);
};

describe("equal", () => {
  it("splits 10.00 across three people without losing a cent", () => {
    const result = computeShares("equal", 1000, inputs(null, null, null));
    expect(result.ok && result.shares.map((s) => s.shareCents)).toEqual([334, 333, 333]);
    expectSumsTo(result, 1000);
  });

  it("ignores excluded members", () => {
    const result = computeShares("equal", 900, [
      { memberId: "a", value: null, included: true },
      { memberId: "b", value: null, included: false },
      { memberId: "c", value: null, included: true },
    ]);
    expect(result.ok && result.shares.map((s) => s.memberId)).toEqual(["a", "c"]);
    expectSumsTo(result, 900);
  });
});

describe("shares", () => {
  it("weights proportionally", () => {
    const result = computeShares("shares", 1200, inputs(2, 1, 1));
    expect(result.ok && result.shares.map((s) => s.shareCents)).toEqual([600, 300, 300]);
    expectSumsTo(result, 1200);
  });

  it("rejects an all-zero weighting", () => {
    expect(computeShares("shares", 1000, inputs(0, 0))).toEqual({
      ok: false,
      error: "invalid_value",
    });
  });

  it("rejects negative weights", () => {
    expect(computeShares("shares", 1000, inputs(-1, 2))).toEqual({
      ok: false,
      error: "invalid_value",
    });
  });
});

describe("percent", () => {
  it("splits by percentage and still sums exactly", () => {
    const result = computeShares("percent", 1000, inputs(33.33, 33.33, 33.34));
    expectSumsTo(result, 1000);
  });

  it("rejects percentages that miss 100", () => {
    expect(computeShares("percent", 1000, inputs(50, 40))).toEqual({
      ok: false,
      error: "percent_sum_mismatch",
    });
  });

  it("tolerates rounding slack of a hundredth", () => {
    expect(computeShares("percent", 1000, inputs(50, 50.005)).ok).toBe(true);
  });
});

describe("exact", () => {
  it("passes the given cents through", () => {
    const result = computeShares("exact", 1000, inputs(700, 300));
    expect(result.ok && result.shares.map((s) => s.shareCents)).toEqual([700, 300]);
  });

  it("rejects a sum that does not match the amount", () => {
    expect(computeShares("exact", 1000, inputs(700, 200))).toEqual({
      ok: false,
      error: "exact_sum_mismatch",
    });
  });

  it("rejects non-integer cents", () => {
    expect(computeShares("exact", 1000, inputs(500.5, 499.5))).toEqual({
      ok: false,
      error: "invalid_value",
    });
  });
});

it("rejects an empty participant list in every mode", () => {
  for (const mode of ["equal", "shares", "percent", "exact"] as const) {
    expect(computeShares(mode, 1000, [])).toEqual({ ok: false, error: "no_participants" });
  }
});
