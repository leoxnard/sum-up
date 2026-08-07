import { describe, expect, it } from "vitest";
import { findDuplicates, normalizeTitle, titleSimilarity } from "./duplicates";
import type { Entry } from "./types";

const entry = (over: Partial<Entry> & { id: string }): Entry => ({
  kind: "expense",
  title: "Dinner",
  note: null,
  category: null,
  categorySource: null,
  payerId: "m1",
  recipientId: null,
  amountCents: 2500,
  currency: "EUR",
  exchangeRate: 1,
  splitMode: "equal",
  expenseDate: "2026-06-10",
  photoId: null,
  updatedAt: 0,
  shares: [],
  ...over,
});

const candidate = { title: "Dinner", amountBaseCents: 2500, date: "2026-06-10" };

describe("normalizeTitle", () => {
  it("strips accents, case and punctuation", () => {
    expect(normalizeTitle("Café Löwe!")).toBe("cafe lowe");
  });
});

describe("titleSimilarity", () => {
  it("is 1 for the same title written differently", () => {
    expect(titleSimilarity("Café Löwe", "cafe  lowe")).toBe(1);
  });

  it("stays high when a bank adds noise around the merchant", () => {
    expect(titleSimilarity("REWE Markt Berlin", "Rewe")).toBeGreaterThan(0.8);
  });

  it("is low for unrelated titles", () => {
    expect(titleSimilarity("Taxi", "Museum tickets")).toBeLessThan(0.2);
  });

  it("is 0 when a title is missing", () => {
    expect(titleSimilarity("", "Dinner")).toBe(0);
  });
});

describe("findDuplicates", () => {
  it("flags the same expense entered twice as likely", () => {
    const matches = findDuplicates(candidate, [entry({ id: "a" })]);
    expect(matches).toHaveLength(1);
    expect(matches[0].level).toBe("likely");
    expect(matches[0].sameAmount).toBe(true);
    expect(matches[0].dayDiff).toBe(0);
  });

  it("still warns quietly when only amount and date line up", () => {
    const matches = findDuplicates(candidate, [entry({ id: "a", title: "Museum" })]);
    expect(matches[0].level).toBe("possible");
  });

  it("tolerates a day or two of drift", () => {
    const matches = findDuplicates(candidate, [entry({ id: "a", expenseDate: "2026-06-12" })]);
    expect(matches[0].level).toBe("likely");
  });

  it("ignores a different amount", () => {
    expect(findDuplicates(candidate, [entry({ id: "a", amountCents: 2600 })])).toEqual([]);
  });

  it("absorbs the cent of drift two exchange rates produce", () => {
    // 25.00 EUR booked once at 1.0 and once as 27.20 USD at a rate that lands a
    // cent beside it.
    const matches = findDuplicates(candidate, [
      entry({ id: "a", amountCents: 2720, currency: "USD", exchangeRate: 0.9195 }),
    ]);
    expect(matches).toHaveLength(1);
    expect(matches[0].sameAmount).toBe(false);
  });

  it("ignores entries more than two weeks away", () => {
    expect(findDuplicates(candidate, [entry({ id: "a", expenseDate: "2026-05-01" })])).toEqual([]);
  });

  it("does not warn about the same amount weeks apart with another title", () => {
    const matches = findDuplicates(candidate, [
      entry({ id: "a", title: "Museum", expenseDate: "2026-06-20" }),
    ]);
    expect(matches).toEqual([]);
  });

  it("never matches a payment", () => {
    expect(
      findDuplicates(candidate, [entry({ id: "a", kind: "payment", title: null })]),
    ).toEqual([]);
  });

  it("never matches the entry being edited", () => {
    expect(findDuplicates({ ...candidate, id: "a" }, [entry({ id: "a" })])).toEqual([]);
  });

  it("returns the strongest matches first and caps the list", () => {
    const matches = findDuplicates(candidate, [
      entry({ id: "a", title: "Museum", expenseDate: "2026-06-12" }),
      entry({ id: "b" }),
      entry({ id: "c", expenseDate: "2026-06-11" }),
      entry({ id: "d", title: "Dinner out" }),
    ]);
    expect(matches.map((m) => m.entry.id)).toEqual(["b", "d", "c"]);
  });

  it("says nothing without a usable amount", () => {
    expect(findDuplicates({ ...candidate, amountBaseCents: 0 }, [entry({ id: "a" })])).toEqual([]);
  });
});
