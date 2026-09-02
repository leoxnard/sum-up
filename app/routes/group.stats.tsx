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
    <main className="pt-2">
      <h1 className="sr-only">{t.statsTitle}</h1>

      <section className="glass animate-rise p-[1.375rem]">
        <div className="text-[0.78125rem] font-semibold text-[var(--text-2)]">
          {t.statsTotal}
        </div>
        <div className="num mt-2 text-[2.5rem] leading-none tracking-[-0.02em]">
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
                    <span className="num shrink-0 text-sm">
                      {formatCents(stats.paid, base, intl)}
                    </span>
                  </div>
                  <div className="mt-2 h-[0.4375rem] overflow-hidden rounded-full bg-[var(--bar-track)]">
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
                  <span className="num shrink-0 text-sm">
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
                  <span className="num shrink-0 text-sm">
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
      <div className="glass glass-list mt-2.5">{children}</div>
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
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-[0.8125rem] transition-colors marker:hidden hover:bg-[var(--glass-shine)]">
        {summary}
        <IconChevronDown
          aria-hidden
          className="size-4 shrink-0 text-[var(--text-2)] transition-transform duration-200 group-open/row:rotate-180"
        />
      </summary>
      {items.length === 0 ? (
        <p className="bg-black/[0.06] px-4 py-3 text-xs text-[var(--text-2)] dark:bg-black/20">
          {t.statsRowEmpty}
        </p>
      ) : (
        <ul className="bg-black/[0.06] dark:bg-black/20">
          {items.map(({ entry, amountBase }) => (
            <li key={entry.id} className="border-t border-[var(--glass-border)]">
              <Link
                to={`../entry/${entry.id}`}
                relative="path"
                className="flex items-center gap-2.5 py-2.5 pl-[2.875rem] pr-4 transition-colors hover:bg-[var(--glass-shine)]"
              >
                <span className="glyph size-6 shrink-0 rounded-lg">
                  <EntryIcon kind={entry.kind} category={entry.category} className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.84375rem]">
                    {entry.title || t.payment}
                  </span>
                  <span className="block text-xs text-[var(--text-2)]">
                    {dateFormat.format(new Date(`${entry.expenseDate}T12:00:00`))}
                  </span>
                </span>
                <span className="num shrink-0 text-[0.84375rem]">
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
