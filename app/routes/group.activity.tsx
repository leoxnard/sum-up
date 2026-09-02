import { Link } from "react-router";
import { useMemo } from "react";

import { useGroup } from "./group";
import { useT } from "../root";
import { formatCents, toBaseCents } from "../lib/money";
import { EntryIcon } from "../components/icons";
import type { Entry } from "../lib/types";

/**
 * The full history, grouped by day. The day header carries that day's spend —
 * payments are left out of it, because moving money between two members doesn't
 * change what the group spent.
 */
export default function GroupActivity() {
  const { snapshot } = useGroup();
  const { t, intl } = useT();
  const base = snapshot.group.baseCurrency;
  const memberName = new Map(snapshot.members.map((m) => [m.id, m.name]));
  const dateFormat = new Intl.DateTimeFormat(intl, { dateStyle: "medium" });

  const days = useMemo(() => groupByDay(snapshot.entries), [snapshot.entries]);

  if (days.length === 0) {
    return (
      <main className="pt-2">
        <h1 className="sr-only">{t.tabActivity}</h1>
        <p className="glass mt-4 px-4 py-10 text-center text-sm text-[var(--text-2)]">
          {t.noEntriesYet}
        </p>
      </main>
    );
  }

  return (
    <main className="pt-2">
      <h1 className="sr-only">{t.tabActivity}</h1>
      <div className="stagger">
        {days.map((day, index) => (
          <section
            key={day.date}
            style={{ "--i": Math.min(index, 12) } as React.CSSProperties}
            className="mt-4 first:mt-0"
          >
            <header className="mb-2.5 flex items-baseline justify-between gap-3 px-1 text-[0.71875rem] font-semibold text-[var(--text-2)]">
              <span>{dateFormat.format(new Date(`${day.date}T12:00:00`))}</span>
              <span className="num text-[0.71875rem]">
                {formatCents(day.totalCents, base, intl)}
              </span>
            </header>
            <div className="glass glass-list">
              {day.entries.map((entry) => (
                <Link
                  key={entry.id}
                  // Absolute: a relative "entry/…" would resolve under
                  // /activity, which is not where the entry route lives.
                  to={`/g/${snapshot.group.slug}/entry/${entry.id}`}
                  className="glass-row pressable"
                >
                  <span
                    className={`glyph ${entry.kind === "payment" ? "glyph-muted" : ""}`}
                  >
                    <EntryIcon
                      kind={entry.kind}
                      category={entry.category}
                      className="size-[1.125rem]"
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.96875rem] font-semibold tracking-[-0.01em]">
                      {entry.kind === "payment"
                        ? `${memberName.get(entry.payerId) ?? "?"} → ${memberName.get(entry.recipientId ?? "") ?? "?"}`
                        : entry.title}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-[var(--text-2)]">
                      {entry.kind === "payment"
                        ? t.payment
                        : `${t.paidBy} ${memberName.get(entry.payerId) ?? "?"}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="num block text-[0.96875rem]">
                      {formatCents(entry.amountCents, entry.currency, intl)}
                    </span>
                    {entry.currency !== base && (
                      <span className="num block text-xs font-medium text-[var(--text-2)]">
                        {formatCents(
                          toBaseCents(entry.amountCents, entry.exchangeRate),
                          base,
                          intl,
                        )}
                      </span>
                    )}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

function groupByDay(entries: Entry[]) {
  const days: { date: string; totalCents: number; entries: Entry[] }[] = [];
  for (const entry of entries) {
    let day = days.at(-1);
    if (day?.date !== entry.expenseDate) {
      day = { date: entry.expenseDate, totalCents: 0, entries: [] };
      days.push(day);
    }
    day.entries.push(entry);
    if (entry.kind !== "payment") {
      day.totalCents += toBaseCents(entry.amountCents, entry.exchangeRate);
    }
  }
  return days;
}
