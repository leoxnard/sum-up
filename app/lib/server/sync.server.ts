import { sql } from "./db.server";
import { categorizeByKeywords, normalizeTitle } from "../categories";
import { isCurrency } from "../currencies";
import { isAccent } from "../accent";
import type { CategoryKey, SyncOp, SyncResult } from "../types";

export interface LlmCandidate {
  entryId: string;
  groupId: string;
  slug: string;
  title: string;
  note: string | null;
}

export interface ApplyOutcome {
  result: SyncResult;
  /** slugs whose data changed — ring the doorbell for these */
  changedSlugs: Set<string>;
  /** expenses that need the async Gemini pass */
  llmCandidates: LlmCandidate[];
}

const ts = (ms: number) => new Date(ms);

/**
 * Apply a batch of sync ops. Idempotent: replaying the same op is a no-op
 * thanks to LWW timestamps. Deletes always win over concurrent upserts.
 */
export async function applySyncOps(ops: SyncOp[]): Promise<ApplyOutcome> {
  const outcome: ApplyOutcome = {
    result: { applied: [], rejected: [] },
    changedSlugs: new Set(),
    llmCandidates: [],
  };

  for (const [index, op] of ops.entries()) {
    try {
      const applied = await applyOne(op, outcome);
      if (applied) {
        outcome.result.applied.push(`${index}`);
        outcome.changedSlugs.add(op.slug);
      } else {
        // Stale (LWW lost) or already-applied ops are still "applied" for the
        // client: the op must leave the outbox either way.
        outcome.result.applied.push(`${index}`);
      }
    } catch (error) {
      if (error instanceof RejectError) {
        outcome.result.rejected.push({ index, reason: error.message });
      } else {
        throw error;
      }
    }
  }
  return outcome;
}

class RejectError extends Error {}

/** The slug is the credential: every op must prove it knows the group's slug. */
async function requireGroup(groupId: string, slug: string) {
  const rows = await sql<{ id: string; deleted_at: Date | null }[]>`
    select id, deleted_at from groups where id = ${groupId} and slug = ${slug}
  `;
  if (rows.length === 0) throw new RejectError("unknown_group");
  return rows[0];
}

async function applyOne(op: SyncOp, outcome: ApplyOutcome): Promise<boolean> {
  switch (op.op) {
    case "upsert_group": {
      const { group } = op;
      if (!group.name.trim()) throw new RejectError("empty_name");
      if (!isCurrency(group.baseCurrency)) throw new RejectError("bad_currency");
      if (!isAccent(group.accentColor)) throw new RejectError("bad_accent");
      if (!/^[A-Za-z0-9_-]{12,64}$/.test(op.slug)) throw new RejectError("bad_slug");
      const existing = await sql<{ slug: string; deleted_at: Date | null }[]>`
        select slug, deleted_at from groups where id = ${group.id}
      `;
      if (existing.length > 0) {
        if (existing[0].slug !== op.slug) throw new RejectError("unknown_group");
        if (existing[0].deleted_at) return false; // deletes win
        const updated = await sql`
          update groups
          set name = ${group.name.trim()}, accent_color = ${group.accentColor},
              updated_at = ${ts(op.clientUpdatedAt)}
          where id = ${group.id} and updated_at < ${ts(op.clientUpdatedAt)}
        `;
        return updated.count > 0;
      }
      await sql`
        insert into groups (id, slug, name, base_currency, accent_color, updated_at)
        values (${group.id}, ${op.slug}, ${group.name.trim()}, ${group.baseCurrency},
                ${group.accentColor}, ${ts(op.clientUpdatedAt)})
        on conflict (slug) do nothing
      `;
      return true;
    }

    case "delete_group": {
      await requireGroup(op.groupId, op.slug);
      await sql`
        update groups set deleted_at = now(), updated_at = ${ts(op.clientUpdatedAt)}
        where id = ${op.groupId} and deleted_at is null
      `;
      return true;
    }

    case "upsert_member": {
      const group = await requireGroup(op.groupId, op.slug);
      if (group.deleted_at) return false;
      if (!op.member.name.trim()) throw new RejectError("empty_name");
      const updated = await sql`
        insert into members (id, group_id, name, updated_at)
        values (${op.member.id}, ${op.groupId}, ${op.member.name.trim()}, ${ts(op.clientUpdatedAt)})
        on conflict (id) do update
          set name = excluded.name, updated_at = excluded.updated_at
          where members.deleted_at is null
            and members.group_id = excluded.group_id
            and members.updated_at < excluded.updated_at
      `;
      return updated.count > 0;
    }

    case "delete_member": {
      const group = await requireGroup(op.groupId, op.slug);
      if (group.deleted_at) return false;
      const used = await sql<{ n: string }[]>`
        select count(*) as n from entries e
        where e.group_id = ${op.groupId} and e.deleted_at is null
          and (e.payer_id = ${op.memberId} or e.recipient_id = ${op.memberId}
               or exists (select 1 from entry_shares s
                          where s.entry_id = e.id and s.member_id = ${op.memberId}))
      `;
      if (Number(used[0].n) > 0) throw new RejectError("member_in_use");
      await sql`
        update members set deleted_at = now(), updated_at = ${ts(op.clientUpdatedAt)}
        where id = ${op.memberId} and group_id = ${op.groupId} and deleted_at is null
      `;
      return true;
    }

    case "upsert_entry": {
      const group = await requireGroup(op.groupId, op.slug);
      if (group.deleted_at) return false;
      const entry = op.entry;
      if (!Number.isInteger(entry.amountCents) || entry.amountCents <= 0) {
        throw new RejectError("bad_amount");
      }
      if (!isCurrency(entry.currency)) throw new RejectError("bad_currency");
      if (!(entry.exchangeRate > 0) || !Number.isFinite(entry.exchangeRate)) {
        throw new RejectError("bad_rate");
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.expenseDate)) throw new RejectError("bad_date");
      if (entry.kind === "expense") {
        const sum = entry.shares.reduce((a, s) => a + s.shareCents, 0);
        if (entry.shares.length === 0 || sum !== entry.amountCents) {
          throw new RejectError("bad_shares");
        }
        if (!entry.title?.trim()) throw new RejectError("empty_title");
      } else {
        if (!entry.recipientId || entry.recipientId === entry.payerId) {
          throw new RejectError("bad_payment");
        }
      }
      const memberIds = new Set(
        (
          await sql<{ id: string }[]>`
            select id from members where group_id = ${op.groupId}
          `
        ).map((m) => m.id),
      );
      const referenced = [
        entry.payerId,
        ...(entry.recipientId ? [entry.recipientId] : []),
        ...entry.shares.map((s) => s.memberId),
      ];
      if (referenced.some((id) => !memberIds.has(id))) throw new RejectError("unknown_member");

      // Categorization: manual beats learned override beats keywords beats LLM.
      let category = entry.category;
      let categorySource = entry.categorySource;
      let needsLlm = false;
      if (entry.kind === "expense" && categorySource !== "manual") {
        const normalized = normalizeTitle(entry.title ?? "");
        const override = await sql<{ category: CategoryKey }[]>`
          select category from category_overrides
          where group_id = ${op.groupId} and title_normalized = ${normalized}
        `;
        if (override.length > 0) {
          category = override[0].category;
          categorySource = "manual";
        } else {
          const keyword = categorizeByKeywords(entry.title ?? "");
          if (keyword) {
            category = keyword;
            categorySource = "keyword";
          } else {
            category = "other";
            categorySource = null;
            needsLlm = true;
          }
        }
      }

      const applied = await sql.begin(async (tx) => {
        const existing = await tx<{ updated_at: Date; deleted_at: Date | null }[]>`
          select updated_at, deleted_at from entries where id = ${entry.id}
        `;
        if (existing.length > 0) {
          if (existing[0].deleted_at) return false; // deletes win
          if (existing[0].updated_at.getTime() >= op.clientUpdatedAt) return false;
        }

        let photoId: string | null | undefined;
        if (op.photoChanged) {
          photoId = null;
          if (op.photoDataUrl) {
            const match = /^data:(image\/[a-z+.-]+);base64,(.+)$/s.exec(op.photoDataUrl);
            if (!match) throw new RejectError("bad_photo");
            const bytes = Buffer.from(match[2], "base64");
            if (bytes.byteLength > 2_000_000) throw new RejectError("photo_too_large");
            photoId = crypto.randomUUID();
            await tx`
              insert into photos (id, group_id, content_type, data)
              values (${photoId}, ${op.groupId}, ${match[1]}, ${bytes})
            `;
          }
        }

        await tx`
          insert into entries (id, group_id, kind, title, note, category, category_source,
            payer_id, recipient_id, amount_cents, currency, exchange_rate, split_mode,
            expense_date, photo_id, updated_at)
          values (${entry.id}, ${op.groupId}, ${entry.kind}, ${entry.title?.trim() || null},
            ${entry.note?.trim() || null}, ${category}, ${categorySource},
            ${entry.payerId}, ${entry.recipientId}, ${entry.amountCents}, ${entry.currency},
            ${entry.exchangeRate}, ${entry.splitMode}, ${entry.expenseDate},
            ${photoId ?? null}, ${ts(op.clientUpdatedAt)})
          on conflict (id) do update set
            title = excluded.title, note = excluded.note,
            category = excluded.category, category_source = excluded.category_source,
            payer_id = excluded.payer_id, recipient_id = excluded.recipient_id,
            amount_cents = excluded.amount_cents, currency = excluded.currency,
            exchange_rate = excluded.exchange_rate, split_mode = excluded.split_mode,
            expense_date = excluded.expense_date, updated_at = excluded.updated_at
            ${photoId === undefined ? tx`` : tx`, photo_id = ${photoId}`}
        `;
        await tx`delete from entry_shares where entry_id = ${entry.id}`;
        for (const share of entry.shares) {
          await tx`
            insert into entry_shares (entry_id, member_id, share_cents, input_value)
            values (${entry.id}, ${share.memberId}, ${share.shareCents}, ${share.inputValue})
          `;
        }
        return true;
      });

      if (applied && needsLlm && entry.title) {
        outcome.llmCandidates.push({
          entryId: entry.id,
          groupId: op.groupId,
          slug: op.slug,
          title: entry.title,
          note: entry.note,
        });
      }
      return applied as boolean;
    }

    case "delete_entry": {
      await requireGroup(op.groupId, op.slug);
      await sql`
        update entries set deleted_at = now(), updated_at = ${ts(op.clientUpdatedAt)}
        where id = ${op.entryId} and group_id = ${op.groupId} and deleted_at is null
      `;
      return true;
    }

    case "set_category": {
      const group = await requireGroup(op.groupId, op.slug);
      if (group.deleted_at) return false;
      await sql`
        update entries
        set category = ${op.category}, category_source = 'manual',
            updated_at = ${ts(op.clientUpdatedAt)}
        where id = ${op.entryId} and group_id = ${op.groupId} and deleted_at is null
      `;
      if (op.title) {
        // Corrections teach the group: same title never needs the API again.
        await sql`
          insert into category_overrides (group_id, title_normalized, category, updated_at)
          values (${op.groupId}, ${normalizeTitle(op.title)}, ${op.category}, now())
          on conflict (group_id, title_normalized)
            do update set category = excluded.category, updated_at = now()
        `;
      }
      return true;
    }
  }
}
