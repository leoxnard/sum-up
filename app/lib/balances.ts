import { distributeByWeights, toBaseCents } from "./money";
import type { Entry, GroupSnapshot } from "./types";

/** memberId -> net balance in base-currency cents. Positive = is owed money. */
export type Balances = Map<string, number>;

/**
 * Recompute all balances from entries. Balances are never stored — they are
 * always derived, so offline sync conflicts cannot corrupt them.
 */
export function computeBalances(snapshot: GroupSnapshot): Balances {
  const balances: Balances = new Map(snapshot.members.map((m) => [m.id, 0]));
  const add = (memberId: string, delta: number) => {
    // Entries may reference members that were since removed on another device;
    // still count them so the group total stays zero.
    balances.set(memberId, (balances.get(memberId) ?? 0) + delta);
  };

  for (const entry of snapshot.entries) {
    const amountBase = toBaseCents(entry.amountCents, entry.exchangeRate);
    if (entry.kind === "payment") {
      add(entry.payerId, amountBase);
      if (entry.recipientId) add(entry.recipientId, -amountBase);
      continue;
    }
    add(entry.payerId, amountBase);
    for (const [i, cents] of shareCentsInBase(entry, amountBase).entries()) {
      add(entry.shares[i].memberId, -cents);
    }
  }
  return balances;
}

/**
 * Convert an entry's original-currency shares into base currency such that they
 * sum exactly to the converted total (largest remainder over the share weights).
 */
export function shareCentsInBase(entry: Entry, amountBase: number): number[] {
  return distributeByWeights(
    amountBase,
    entry.shares.map((s) => s.shareCents),
  );
}

export interface SettleTransfer {
  fromId: string;
  toId: string;
  amountCents: number;
}

/**
 * Greedy settle-up: repeatedly match the largest debtor with the largest
 * creditor. At most n-1 transfers; triangular shortcuts allowed by design.
 */
export function suggestSettlement(balances: Balances): SettleTransfer[] {
  const debtors: { id: string; amount: number }[] = [];
  const creditors: { id: string; amount: number }[] = [];
  for (const [id, balance] of balances) {
    if (balance <= -1) debtors.push({ id, amount: -balance });
    else if (balance >= 1) creditors.push({ id, amount: balance });
  }
  debtors.sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));
  creditors.sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));

  const transfers: SettleTransfer[] = [];
  let d = 0;
  let c = 0;
  while (d < debtors.length && c < creditors.length) {
    const amount = Math.min(debtors[d].amount, creditors[c].amount);
    transfers.push({ fromId: debtors[d].id, toId: creditors[c].id, amountCents: amount });
    debtors[d].amount -= amount;
    creditors[c].amount -= amount;
    if (debtors[d].amount === 0) d += 1;
    if (creditors[c].amount === 0) c += 1;
  }
  return transfers;
}

/** Per-member totals for the stats screen, in base cents. */
export function computeMemberStats(snapshot: GroupSnapshot) {
  const stats = new Map(
    snapshot.members.map((m) => [m.id, { paid: 0, owedShare: 0 }]),
  );
  for (const entry of snapshot.entries) {
    if (entry.kind !== "expense") continue;
    const amountBase = toBaseCents(entry.amountCents, entry.exchangeRate);
    const payer = stats.get(entry.payerId);
    if (payer) payer.paid += amountBase;
    for (const [i, cents] of shareCentsInBase(entry, amountBase).entries()) {
      const s = stats.get(entry.shares[i].memberId);
      if (s) s.owedShare += cents;
    }
  }
  return stats;
}

/** Per-category totals (expenses only), in base cents. */
export function computeCategoryStats(snapshot: GroupSnapshot) {
  const totals = new Map<string, number>();
  for (const entry of snapshot.entries) {
    if (entry.kind !== "expense") continue;
    const key = entry.category ?? "other";
    totals.set(key, (totals.get(key) ?? 0) + toBaseCents(entry.amountCents, entry.exchangeRate));
  }
  return totals;
}
