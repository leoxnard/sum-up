import { describe, expect, it } from "vitest";
import { parseOps } from "./parse-ops";

const base = { slug: "abc", clientUpdatedAt: 1, groupId: "g1" };

const validEntryOp = {
  ...base,
  op: "upsert_entry",
  entry: {
    id: "e1",
    kind: "expense",
    payerId: "m1",
    shares: [{ memberId: "m1", shareCents: 100, inputValue: null }],
    expenseDate: "2026-01-01",
  },
};

describe("parseOps", () => {
  it("accepts an empty batch", () => {
    expect(parseOps([])).toEqual([]);
  });

  it("accepts a well-formed op of each kind", () => {
    const ops = [
      { ...base, op: "upsert_group", group: { id: "g1", name: "G", baseCurrency: "EUR", accentColor: "blue" } },
      { ...base, op: "delete_group" },
      { ...base, op: "upsert_member", member: { id: "m1", name: "A" } },
      { ...base, op: "delete_member", memberId: "m1" },
      validEntryOp,
      { ...base, op: "delete_entry", entryId: "e1" },
      { ...base, op: "set_category", entryId: "e1", title: "Pizza", category: "food" },
    ];
    expect(parseOps(ops)).toHaveLength(7);
  });

  it("rejects a non-array payload", () => {
    expect(parseOps(null)).toBeNull();
    expect(parseOps({ op: "delete_entry" })).toBeNull();
    expect(parseOps("nope")).toBeNull();
  });

  it("rejects an unknown op name", () => {
    expect(parseOps([{ ...base, op: "frobnicate" }])).toBeNull();
  });

  // The exact payload that used to throw a TypeError inside applyOne and 500
  // the whole request after earlier ops had already committed.
  it("rejects an upsert_entry with no entry", () => {
    expect(parseOps([{ ...base, op: "upsert_entry" }])).toBeNull();
  });

  it("rejects an entry whose shares are not an array", () => {
    expect(
      parseOps([{ ...validEntryOp, entry: { ...validEntryOp.entry, shares: "nope" } }]),
    ).toBeNull();
  });

  it("rejects a malformed share", () => {
    expect(
      parseOps([{ ...validEntryOp, entry: { ...validEntryOp.entry, shares: [{ memberId: "m1" }] } }]),
    ).toBeNull();
  });

  it("rejects missing slug or clientUpdatedAt", () => {
    expect(parseOps([{ ...validEntryOp, slug: "" }])).toBeNull();
    expect(parseOps([{ ...validEntryOp, clientUpdatedAt: "soon" }])).toBeNull();
    expect(parseOps([{ ...validEntryOp, clientUpdatedAt: Number.NaN }])).toBeNull();
  });

  it("rejects a member op with no name", () => {
    expect(parseOps([{ ...base, op: "upsert_member", member: { id: "m1" } }])).toBeNull();
  });

  it("rejects the whole batch when one op is bad", () => {
    expect(parseOps([validEntryOp, { ...base, op: "delete_entry" }])).toBeNull();
  });

  // Semantic validation stays in applyOne — parseOps only guards the shape.
  it("passes semantically invalid but structurally sound ops through", () => {
    const ops = parseOps([
      { ...validEntryOp, entry: { ...validEntryOp.entry, expenseDate: "not-a-date" } },
    ]);
    expect(ops).toHaveLength(1);
  });
});
