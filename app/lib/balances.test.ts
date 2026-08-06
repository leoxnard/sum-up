import { describe, expect, it } from "vitest";
import { computeBalances, computeCategoryStats, computeMemberStats, suggestSettlement } from "./balances";
import { distributeByWeights } from "./money";
import type { Entry, GroupSnapshot, Member } from "./types";

const members = (n: number): Member[] =>
  Array.from({ length: n }, (_, i) => ({ id: `m${i}`, name: `M${i}`, updatedAt: 0 }));

function expense(over: Partial<Entry> & Pick<Entry, "id" | "payerId" | "amountCents">): Entry {
  const participants = over.shares?.map((s) => s.memberId) ?? [over.payerId];
  const split = distributeByWeights(over.amountCents, participants.map(() => 1));
  return {
    kind: "expense",
    title: "x",
    note: null,
    category: null,
    categorySource: null,
    recipientId: null,
    currency: "EUR",
    exchangeRate: 1,
    splitMode: "equal",
    expenseDate: "2026-01-01",
    photoId: null,
    updatedAt: 0,
    shares: participants.map((memberId, i) => ({
      memberId,
      shareCents: split[i],
      inputValue: null,
    })),
    ...over,
  };
}

const snapshot = (memberCount: number, entries: Entry[]): GroupSnapshot => ({
  group: {
    id: "g",
    slug: "s",
    name: "G",
    baseCurrency: "EUR",
    accentColor: "blue",
    updatedAt: 0,
  },
  members: members(memberCount),
  entries,
  fetchedAt: 0,
});

describe("computeBalances", () => {
  it("credits the payer and debits every participant", () => {
    const balances = computeBalances(
      snapshot(3, [
        expense({
          id: "e1",
          payerId: "m0",
          amountCents: 3000,
          shares: [
            { memberId: "m0", shareCents: 1000, inputValue: null },
            { memberId: "m1", shareCents: 1000, inputValue: null },
            { memberId: "m2", shareCents: 1000, inputValue: null },
          ],
        }),
      ]),
    );
    expect(balances.get("m0")).toBe(2000);
    expect(balances.get("m1")).toBe(-1000);
    expect(balances.get("m2")).toBe(-1000);
  });

  it("moves a payment's balance toward zero", () => {
    const balances = computeBalances(
      snapshot(2, [
        expense({
          id: "e1",
          payerId: "m0",
          amountCents: 1000,
          shares: [
            { memberId: "m0", shareCents: 500, inputValue: null },
            { memberId: "m1", shareCents: 500, inputValue: null },
          ],
        }),
        expense({ id: "p1", kind: "payment", payerId: "m1", recipientId: "m0", amountCents: 500, shares: [] }),
      ]),
    );
    expect(balances.get("m0")).toBe(0);
    expect(balances.get("m1")).toBe(0);
  });

  it("converts foreign-currency entries with the frozen rate", () => {
    const balances = computeBalances(
      snapshot(2, [
        expense({
          id: "e1",
          payerId: "m0",
          amountCents: 10000,
          currency: "CHF",
          exchangeRate: 1.07,
          shares: [
            { memberId: "m0", shareCents: 5000, inputValue: null },
            { memberId: "m1", shareCents: 5000, inputValue: null },
          ],
        }),
      ]),
    );
    // 100.00 CHF -> 107.00 EUR, split into 53.50 each.
    expect(balances.get("m0")).toBe(5350);
    expect(balances.get("m1")).toBe(-5350);
  });

  // The core ledger invariant: money is only ever moved between members.
  it("sums to zero across randomized ledgers", () => {
    let seed = 42;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let run = 0; run < 400; run++) {
      const memberCount = 2 + rand(5);
      const ids = members(memberCount).map((m) => m.id);
      const entries: Entry[] = [];
      for (let e = 0; e < 1 + rand(8); e++) {
        const amount = 1 + rand(500_000);
        const rate = [1, 1.07, 0.86, 1.1834][rand(4)];
        if (rand(4) === 0) {
          const from = rand(memberCount);
          let to = rand(memberCount);
          if (to === from) to = (to + 1) % memberCount;
          entries.push(
            expense({
              id: `p${e}`,
              kind: "payment",
              payerId: ids[from],
              recipientId: ids[to],
              amountCents: amount,
              exchangeRate: rate,
              shares: [],
            }),
          );
        } else {
          const participants = ids.filter(() => rand(2) === 0);
          if (participants.length === 0) participants.push(ids[0]);
          const split = distributeByWeights(amount, participants.map(() => 1 + rand(4)));
          entries.push(
            expense({
              id: `e${e}`,
              payerId: ids[rand(memberCount)],
              amountCents: amount,
              exchangeRate: rate,
              shares: participants.map((memberId, i) => ({
                memberId,
                shareCents: split[i],
                inputValue: null,
              })),
            }),
          );
        }
      }
      const balances = computeBalances(snapshot(memberCount, entries));
      const total = [...balances.values()].reduce((a, b) => a + b, 0);
      expect(total).toBe(0);
    }
  });

  // Regression guard: an entry whose shares are all zero credits the payer the
  // full amount while debiting nobody, so the ledger stops summing to zero. The
  // server rejects this (sync.server.ts "bad_shares"), but the optimistic
  // client overlay computes balances from unvalidated ops.
  it("documents the all-zero-shares hole the server closes", () => {
    const balances = computeBalances(
      snapshot(2, [
        expense({
          id: "e1",
          payerId: "m0",
          amountCents: 1000,
          shares: [
            { memberId: "m0", shareCents: 0, inputValue: null },
            { memberId: "m1", shareCents: 0, inputValue: null },
          ],
        }),
      ]),
    );
    expect([...balances.values()].reduce((a, b) => a + b, 0)).toBe(1000);
  });
});

describe("suggestSettlement", () => {
  it("zeroes every balance in at most n-1 transfers", () => {
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let run = 0; run < 400; run++) {
      const n = 2 + rand(7);
      const values: number[] = [];
      for (let i = 0; i < n - 1; i++) values.push(rand(200_000) - 100_000);
      values.push(-values.reduce((a, b) => a + b, 0));

      const balances = new Map(values.map((v, i) => [`m${i}`, v]));
      const transfers = suggestSettlement(balances);
      expect(transfers.length).toBeLessThanOrEqual(n - 1);

      const settled = new Map(balances);
      for (const t of transfers) {
        settled.set(t.fromId, settled.get(t.fromId)! + t.amountCents);
        settled.set(t.toId, settled.get(t.toId)! - t.amountCents);
        expect(t.amountCents).toBeGreaterThan(0);
      }
      for (const value of settled.values()) expect(value).toBe(0);
    }
  });

  it("suggests nothing when everyone is square", () => {
    expect(suggestSettlement(new Map([["a", 0], ["b", 0]]))).toEqual([]);
  });

  it("matches the largest debtor with the largest creditor", () => {
    const transfers = suggestSettlement(
      new Map([["a", -3000], ["b", -1000], ["c", 4000]]),
    );
    expect(transfers).toEqual([
      { fromId: "a", toId: "c", amountCents: 3000 },
      { fromId: "b", toId: "c", amountCents: 1000 },
    ]);
  });
});

describe("stats", () => {
  const data = snapshot(2, [
    expense({
      id: "e1",
      payerId: "m0",
      amountCents: 1000,
      category: "food",
      shares: [
        { memberId: "m0", shareCents: 400, inputValue: null },
        { memberId: "m1", shareCents: 600, inputValue: null },
      ],
    }),
    expense({ id: "p1", kind: "payment", payerId: "m1", recipientId: "m0", amountCents: 600, shares: [] }),
  ]);

  it("counts paid and owed per member, ignoring payments", () => {
    const stats = computeMemberStats(data);
    expect(stats.get("m0")).toEqual({ paid: 1000, owedShare: 400 });
    expect(stats.get("m1")).toEqual({ paid: 0, owedShare: 600 });
  });

  it("buckets uncategorized expenses as other", () => {
    expect(computeCategoryStats(data).get("food")).toBe(1000);
    expect(computeCategoryStats(snapshot(1, [expense({ id: "e", payerId: "m0", amountCents: 500 })])).get("other")).toBe(500);
  });
});
