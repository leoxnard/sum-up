import { sql } from "./db.server";
import type {
  CategoryKey,
  CategorySource,
  Entry,
  EntryKind,
  GroupSnapshot,
  SplitMode,
} from "../types";

interface GroupRow {
  id: string;
  slug: string;
  name: string;
  base_currency: string;
  accent_color: string;
  updated_at: Date;
}

export async function loadGroupBySlug(slug: string): Promise<GroupRow | null> {
  const rows = await sql<GroupRow[]>`
    select id, slug, name, base_currency, accent_color, updated_at
    from groups where slug = ${slug} and deleted_at is null
  `;
  return rows[0] ?? null;
}

export async function loadSnapshot(slug: string): Promise<GroupSnapshot | null> {
  const group = await loadGroupBySlug(slug);
  if (!group) return null;

  const members = await sql<{ id: string; name: string; updated_at: Date }[]>`
    select id, name, updated_at from members
    where group_id = ${group.id} and deleted_at is null
    order by created_at
  `;

  const entryRows = await sql<
    {
      id: string;
      kind: EntryKind;
      title: string | null;
      note: string | null;
      category: CategoryKey | null;
      category_source: CategorySource | null;
      payer_id: string;
      recipient_id: string | null;
      amount_cents: string;
      currency: string;
      exchange_rate: string;
      split_mode: SplitMode;
      expense_date: string;
      photo_id: string | null;
      updated_at: Date;
    }[]
  >`
    select id, kind, title, note, category, category_source, payer_id, recipient_id,
      amount_cents, currency, exchange_rate, split_mode,
      to_char(expense_date, 'YYYY-MM-DD') as expense_date, photo_id, updated_at
    from entries
    where group_id = ${group.id} and deleted_at is null
    order by expense_date desc, created_at desc
  `;

  const shares = await sql<
    { entry_id: string; member_id: string; share_cents: string; input_value: string | null }[]
  >`
    select s.entry_id, s.member_id, s.share_cents, s.input_value
    from entry_shares s
    join entries e on e.id = s.entry_id
    where e.group_id = ${group.id} and e.deleted_at is null
  `;
  const sharesByEntry = new Map<string, Entry["shares"]>();
  for (const share of shares) {
    const list = sharesByEntry.get(share.entry_id) ?? [];
    list.push({
      memberId: share.member_id,
      shareCents: Number(share.share_cents),
      inputValue: share.input_value === null ? null : Number(share.input_value),
    });
    sharesByEntry.set(share.entry_id, list);
  }

  return {
    group: {
      id: group.id,
      slug: group.slug,
      name: group.name,
      baseCurrency: group.base_currency,
      accentColor: group.accent_color,
      updatedAt: group.updated_at.getTime(),
    },
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      updatedAt: m.updated_at.getTime(),
    })),
    entries: entryRows.map((e) => ({
      id: e.id,
      kind: e.kind,
      title: e.title,
      note: e.note,
      category: e.category,
      categorySource: e.category_source,
      payerId: e.payer_id,
      recipientId: e.recipient_id,
      amountCents: Number(e.amount_cents),
      currency: e.currency,
      exchangeRate: Number(e.exchange_rate),
      splitMode: e.split_mode,
      expenseDate: e.expense_date,
      photoId: e.photo_id,
      updatedAt: e.updated_at.getTime(),
      shares: (sharesByEntry.get(e.id) ?? []).sort((a, b) =>
        a.memberId.localeCompare(b.memberId),
      ),
    })),
    fetchedAt: Date.now(),
  };
}
