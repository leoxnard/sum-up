// Mirror of the server's sync semantics, applied to a cached snapshot so queued
// (not yet synced) changes are visible immediately — the optimistic overlay.
import type { Entry, GroupSnapshot, SyncOp } from "../types";
import { categorizeByKeywords } from "../categories";

export function overlayOps(snapshot: GroupSnapshot, ops: SyncOp[]): GroupSnapshot {
  let result: GroupSnapshot = {
    ...snapshot,
    members: [...snapshot.members],
    entries: [...snapshot.entries],
  };
  for (const op of ops) {
    if (op.slug !== result.group.slug) continue;
    result = applyOp(result, op);
  }
  // Keep the list order the server would produce.
  result.entries.sort(
    (a, b) => b.expenseDate.localeCompare(a.expenseDate) || b.updatedAt - a.updatedAt,
  );
  return result;
}

function applyOp(snapshot: GroupSnapshot, op: SyncOp): GroupSnapshot {
  switch (op.op) {
    case "upsert_group":
      return {
        ...snapshot,
        group: {
          ...snapshot.group,
          name: op.group.name,
          accentColor: op.group.accentColor,
        },
      };
    case "upsert_member": {
      const members = snapshot.members.filter((m) => m.id !== op.member.id);
      members.push({ id: op.member.id, name: op.member.name, updatedAt: op.clientUpdatedAt });
      return { ...snapshot, members };
    }
    case "delete_member":
      return {
        ...snapshot,
        members: snapshot.members.filter((m) => m.id !== op.memberId),
      };
    case "upsert_entry": {
      const previous = snapshot.entries.find((e) => e.id === op.entry.id);
      const entry: Entry = {
        ...op.entry,
        category:
          op.entry.categorySource === "manual"
            ? op.entry.category
            : categorizeByKeywords(op.entry.title ?? "") ?? "other",
        categorySource:
          op.entry.categorySource === "manual"
            ? "manual"
            : categorizeByKeywords(op.entry.title ?? "")
              ? "keyword"
              : null,
        photoId: previous?.photoId ?? null,
        updatedAt: op.clientUpdatedAt,
      };
      return {
        ...snapshot,
        entries: [entry, ...snapshot.entries.filter((e) => e.id !== entry.id)],
      };
    }
    case "delete_entry":
      return {
        ...snapshot,
        entries: snapshot.entries.filter((e) => e.id !== op.entryId),
      };
    case "set_category":
      return {
        ...snapshot,
        entries: snapshot.entries.map((e) =>
          e.id === op.entryId
            ? { ...e, category: op.category, categorySource: "manual" as const }
            : e,
        ),
      };
    case "delete_group":
      return snapshot;
  }
}
