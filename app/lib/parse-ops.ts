// Structural validation for the /api/sync payload.
//
// `applyOne` already does all the *semantic* checks (amounts, currencies, date
// format, share sums, member references) and reports failures as RejectError.
// What it cannot survive is a payload whose *shape* is wrong: it dereferences
// `op.entry.shares`, `op.member.name`, `op.group.name` directly, so a missing
// field throws a TypeError, which is not a RejectError and therefore aborts the
// whole batch — after earlier ops have already committed.
//
// This module closes that gap and nothing more. It deliberately does not
// duplicate any check that applyOne performs.
import type { SyncOp } from "./types";

const OP_NAMES = [
  "upsert_group",
  "delete_group",
  "upsert_member",
  "delete_member",
  "upsert_entry",
  "delete_entry",
  "set_category",
] as const;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** Fields every op carries, whatever its kind. */
function hasCommonFields(op: Record<string, unknown>): boolean {
  return (
    isNonEmptyString(op.slug) &&
    typeof op.clientUpdatedAt === "number" &&
    Number.isFinite(op.clientUpdatedAt)
  );
}

function hasKindFields(op: Record<string, unknown>): boolean {
  switch (op.op) {
    case "upsert_group":
      return isObject(op.group) && isNonEmptyString(op.group.id);
    case "delete_group":
      return isNonEmptyString(op.groupId);
    case "upsert_member":
      return (
        isNonEmptyString(op.groupId) &&
        isObject(op.member) &&
        isNonEmptyString(op.member.id) &&
        typeof op.member.name === "string"
      );
    case "delete_member":
      return isNonEmptyString(op.groupId) && isNonEmptyString(op.memberId);
    case "upsert_entry": {
      if (!isNonEmptyString(op.groupId) || !isObject(op.entry)) return false;
      const e = op.entry;
      return (
        isNonEmptyString(e.id) &&
        (e.kind === "expense" || e.kind === "payment") &&
        isNonEmptyString(e.payerId) &&
        Array.isArray(e.shares) &&
        e.shares.every(
          (s) => isObject(s) && isNonEmptyString(s.memberId) && typeof s.shareCents === "number",
        ) &&
        typeof e.expenseDate === "string" &&
        (op.photoDataUrl == null || typeof op.photoDataUrl === "string")
      );
    }
    case "delete_entry":
      return isNonEmptyString(op.groupId) && isNonEmptyString(op.entryId);
    case "set_category":
      return (
        isNonEmptyString(op.groupId) &&
        isNonEmptyString(op.entryId) &&
        isNonEmptyString(op.category) &&
        (op.title === null || typeof op.title === "string")
      );
    default:
      return false;
  }
}

/**
 * Returns the ops when every entry is structurally sound, otherwise null.
 * All-or-nothing on purpose: a malformed batch is a client bug, and applying
 * half of it would leave the outbox in a state neither side can reason about.
 */
export function parseOps(raw: unknown): SyncOp[] | null {
  if (!Array.isArray(raw)) return null;
  for (const op of raw) {
    if (!isObject(op)) return null;
    if (!OP_NAMES.includes(op.op as (typeof OP_NAMES)[number])) return null;
    if (!hasCommonFields(op)) return null;
    if (!hasKindFields(op)) return null;
  }
  return raw as SyncOp[];
}
