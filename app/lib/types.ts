// Domain types shared between server, client and the offline sync layer.

export type SplitMode = "equal" | "exact" | "percent" | "shares";
export type EntryKind = "expense" | "payment";
export type CategorySource = "keyword" | "llm" | "manual";

export type CategoryKey =
  | "food"
  | "groceries"
  | "transport"
  | "accommodation"
  | "activities"
  | "shopping"
  | "other";

export interface Group {
  id: string;
  slug: string;
  name: string;
  baseCurrency: string;
  accentColor: string;
  updatedAt: number;
}

export interface Member {
  id: string;
  name: string;
  updatedAt: number;
}

export interface EntryShare {
  memberId: string;
  /** owed amount in the entry's original currency cents; all shares sum exactly to amountCents */
  shareCents: number;
  /** raw form input for the split mode (percent, share count, exact cents) */
  inputValue: number | null;
}

export interface Entry {
  id: string;
  kind: EntryKind;
  title: string | null;
  note: string | null;
  category: CategoryKey | null;
  categorySource: CategorySource | null;
  payerId: string;
  recipientId: string | null;
  amountCents: number;
  currency: string;
  /** multiplier original -> group base currency, frozen at entry time */
  exchangeRate: number;
  splitMode: SplitMode;
  /** ISO date yyyy-mm-dd */
  expenseDate: string;
  photoId: string | null;
  updatedAt: number;
  shares: EntryShare[];
}

/** Everything a client needs to render a group; mirrored into IndexedDB for offline. */
export interface GroupSnapshot {
  group: Group;
  members: Member[];
  entries: Entry[];
  fetchedAt: number;
}

// ---- Sync ops (the single mutation vocabulary, online and offline) ----

export type SyncOp =
  | {
      op: "upsert_group";
      slug: string;
      clientUpdatedAt: number;
      group: { id: string; name: string; baseCurrency: string; accentColor: string };
    }
  | {
      op: "delete_group";
      slug: string;
      clientUpdatedAt: number;
      groupId: string;
    }
  | {
      op: "upsert_member";
      slug: string;
      clientUpdatedAt: number;
      groupId: string;
      member: { id: string; name: string };
    }
  | {
      op: "delete_member";
      slug: string;
      clientUpdatedAt: number;
      groupId: string;
      memberId: string;
    }
  | {
      op: "upsert_entry";
      slug: string;
      clientUpdatedAt: number;
      groupId: string;
      entry: Omit<Entry, "updatedAt" | "category" | "categorySource" | "photoId"> & {
        category: CategoryKey | null;
        categorySource: CategorySource | null;
      };
      /** resized receipt image as data URL, uploaded together with the entry */
      photoDataUrl?: string | null;
      /** true when the user explicitly removed/kept no photo (distinguishes from "unchanged") */
      photoChanged?: boolean;
    }
  | {
      op: "delete_entry";
      slug: string;
      clientUpdatedAt: number;
      groupId: string;
      entryId: string;
    }
  | {
      op: "set_category";
      slug: string;
      clientUpdatedAt: number;
      groupId: string;
      entryId: string;
      title: string | null;
      category: CategoryKey;
    };

export interface SyncResult {
  applied: string[];
  /** ops rejected permanently (bad slug, validation) — client should drop them */
  rejected: { index: number; reason: string }[];
}
