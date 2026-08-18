import { Link } from "react-router";
import { useMemo } from "react";

import { useGroup } from "./group";
import { useT } from "../root";
import { computeCategoryStats, computeMemberStats, type StatEntry } from "../lib/balances";
import { formatCents, toBaseCents } from "../lib/money";
import { CATEGORIES } from "../lib/categories";
import { CategoryIcon, EntryIcon, IconChevronDown } from "../components/icons";
import { categoryLabel } from "../lib/i18n";
import type { CategoryKey } from "../lib/types";

export default function Stats() {
  const { snapshot } = useGroup();
  const { t, intl } = useT();
  const base = snapshot.group.baseCurrency;

  const memberStats = useMemo(() => computeMemberStats(snapshot), [snapshot]);
  const categoryStats = useMemo(() => computeCategoryStats(snapshot), [snapshot]);
  const total = useMemo(
    () =>
      snapshot.entries
        .filter((e) => e.kind === "expense")
        .reduce((a, e) => a + toBaseCents(e.amountCents, e.exchangeRate), 0),
    [snapshot],
  );
  const maxPaid = Math.max(1, ...[...memberStats.values()].map((s) => s.paid));

  return (
    <main className="animate-rise px-4 pb-16 pt-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">{t.statsTitle}</h1>
        <Link to={`/g/${snapshot.group.slug}`} className="btn btn-ghost -mr-3">
          {t.cancel}
        </Link>
      </header>

      <section
        className="relative mt-5 overflow-hidden rounded-[var(--radius-card)] px-5 py-5 text-white"
        style={{
          background:
            "linear-gradient(135deg, color-mix(in oklab, var(--accent) 88%, white) 0%, var(--accent) 55%, color-mix(in oklab, var(--accent) 80%, black) 100%)",
          boxShadow: "var(--shadow-pop)",
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute -right-10 -top-16 size-44 rounded-full bg-white/15 blur-2xl"
        />
        <div className="text-sm/none font-medium opacity-75">{t.statsTotal}</div>
        <div className="mt-2 text-[2.15rem] font-bold leading-none tabular-nums">
          {formatCents(total, base, intl)}
        </div>
      </section>

      <Section title={t.statsSpending}>
        {snapshot.members.map((member) => {
          const stats = memberStats.get(member.id);
          if (!stats) return null;
          return (
            <Expandable
              key={member.id}
              base={base}
              items={stats.paidEntries}
              summary={
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between gap-3 text-sm">
                    <span className="truncate font-medium">{member.name}</span>
                    <span className="shrink-0 font-semibold tabular-nums">
                      {formatCents(stats.paid, base, intl)}
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
                    <div
                      className="bar-fill h-full rounded-full bg-[var(--accent)]"
                      style={{ width: `${(stats.paid / maxPaid) * 100}%` }}
                    />
                  </div>
                </div>
              }
            />
          );
        })}
      </Section>

      <Section title={t.statsShare}>
        {snapshot.members.map((member) => {
          const stats = memberStats.get(member.id);
          if (!stats) return null;
          return (
            <Expandable
              key={member.id}
              base={base}
              items={stats.shareEntries}
              summary={
                <div className="flex min-w-0 flex-1 justify-between gap-3 text-sm">
                  <span className="truncate font-medium">{member.name}</span>
                  <span className="shrink-0 tabular-nums">
                    {formatCents(stats.owedShare, base, intl)}
                  </span>
                </div>
              }
            />
          );
        })}
      </Section>

      <Section title={t.statsCategories}>
        {CATEGORIES.filter((c) => categoryStats.has(c)).map((category) => {
          const stats = categoryStats.get(category)!;
          return (
            <Expandable
              key={category}
              base={base}
              items={stats.entries}
              summary={
                <div className="flex min-w-0 flex-1 items-center justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2.5 font-medium">
                    <span className="glyph size-8 shrink-0 rounded-lg">
                      <CategoryIcon category={category as CategoryKey} className="size-4" />
                    </span>
                    <span className="truncate">{categoryLabel(t, category as CategoryKey)}</span>
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {formatCents(stats.total, base, intl)}
                  </span>
                </div>
              }
            />
          );
        })}
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="section-label">{title}</h2>
      <div className="card row-divider mt-2.5 overflow-hidden">{children}</div>
    </section>
  );
}

/**
 * A stats row that unfolds into the expenses it is made of. Native `<details>`
 * so it works before hydration and keeps its own state — the summary is the
 * whole row, so tapping anywhere on it opens the breakdown.
 */
function Expandable({
  summary,
  items,
  base,
}: {
  summary: React.ReactNode;
  items: StatEntry[];
  base: string;
}) {
  const { t, intl } = useT();
  const dateFormat = new Intl.DateTimeFormat(intl, { dateStyle: "medium" });

  return (
    <details className="group/row">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 transition-colors marker:hidden hover:bg-[var(--surface-sunken)]">
        {summary}
        <IconChevronDown
          aria-hidden
          className="size-4 shrink-0 text-[var(--text-muted)] transition-transform duration-200 group-open/row:rotate-180"
        />
      </summary>
      {items.length === 0 ? (
        <p className="bg-[var(--surface-sunken)] px-4 py-3 text-xs text-[var(--text-muted)]">
          {t.statsRowEmpty}
        </p>
      ) : (
        <ul className="bg-[var(--surface-sunken)]">
          {items.map(({ entry, amountBase }) => (
            <li key={entry.id} className="border-t border-[var(--line)]">
              <Link
                to={`../entry/${entry.id}`}
                relative="path"
                className="flex items-center gap-2.5 px-4 py-2.5 transition-colors hover:bg-[var(--surface)]"
              >
                <span className="glyph size-7 shrink-0 rounded-lg">
                  <EntryIcon kind={entry.kind} category={entry.category} className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{entry.title || t.payment}</span>
                  <span className="block text-xs text-[var(--text-muted)]">
                    {dateFormat.format(new Date(`${entry.expenseDate}T12:00:00`))}
                  </span>
                </span>
                <span className="shrink-0 text-sm tabular-nums">
                  {formatCents(amountBase, base, intl)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
