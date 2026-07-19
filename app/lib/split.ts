import { distributeByWeights } from "./money";
import type { EntryShare, SplitMode } from "./types";

export interface SplitInput {
  memberId: string;
  /** meaning depends on mode: shares count, percent, or exact cents; ignored for equal */
  value: number | null;
  included: boolean;
}

export type SplitResult =
  | { ok: true; shares: EntryShare[] }
  | { ok: false; error: "no_participants" | "exact_sum_mismatch" | "percent_sum_mismatch" | "invalid_value" };

/**
 * Compute exact-summing shares (in the entry's original currency cents) for a
 * split mode. Deterministic: same input, same output, shares sum to amountCents.
 */
export function computeShares(
  mode: SplitMode,
  amountCents: number,
  inputs: SplitInput[],
): SplitResult {
  const included = inputs.filter((i) => i.included);
  if (included.length === 0) return { ok: false, error: "no_participants" };

  switch (mode) {
    case "equal": {
      const split = distributeByWeights(
        amountCents,
        included.map(() => 1),
      );
      return {
        ok: true,
        shares: included.map((i, idx) => ({
          memberId: i.memberId,
          shareCents: split[idx],
          inputValue: null,
        })),
      };
    }
    case "shares": {
      const weights = included.map((i) => i.value ?? 0);
      if (weights.some((w) => w < 0 || !Number.isFinite(w)) || weights.every((w) => w === 0)) {
        return { ok: false, error: "invalid_value" };
      }
      const split = distributeByWeights(amountCents, weights);
      return {
        ok: true,
        shares: included.map((i, idx) => ({
          memberId: i.memberId,
          shareCents: split[idx],
          inputValue: i.value ?? 0,
        })),
      };
    }
    case "percent": {
      const percents = included.map((i) => i.value ?? 0);
      if (percents.some((p) => p < 0 || !Number.isFinite(p))) {
        return { ok: false, error: "invalid_value" };
      }
      const sum = percents.reduce((a, b) => a + b, 0);
      if (Math.abs(sum - 100) > 0.01) return { ok: false, error: "percent_sum_mismatch" };
      // Percentages become integer basis points so the weight math stays exact.
      const split = distributeByWeights(
        amountCents,
        percents.map((p) => Math.round(p * 100)),
      );
      return {
        ok: true,
        shares: included.map((i, idx) => ({
          memberId: i.memberId,
          shareCents: split[idx],
          inputValue: i.value ?? 0,
        })),
      };
    }
    case "exact": {
      const cents = included.map((i) => i.value ?? 0);
      if (cents.some((c) => c < 0 || !Number.isInteger(c))) {
        return { ok: false, error: "invalid_value" };
      }
      if (cents.reduce((a, b) => a + b, 0) !== amountCents) {
        return { ok: false, error: "exact_sum_mismatch" };
      }
      return {
        ok: true,
        shares: included.map((i, idx) => ({
          memberId: i.memberId,
          shareCents: cents[idx],
          inputValue: cents[idx],
        })),
      };
    }
  }
}
