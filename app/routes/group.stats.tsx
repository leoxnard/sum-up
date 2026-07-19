import { Link } from "react-router";
import { useMemo } from "react";

import { useGroup } from "./group";
import { useT } from "../root";
import { computeCategoryStats, computeMemberStats } from "../lib/balances";
import { formatCents, toBaseCents } from "../lib/money";
import { CATEGORY_EMOJI, CATEGORIES } from "../lib/categories";
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
    <main className="px-4 pb-16 pt-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{t.statsTitle}</h1>
        <Link to={`/g/${snapshot.group.slug}`} className="text-sm text-neutral-500">
          {t.cancel}
        </Link>
      </header>

      <section className="mt-5 rounded-2xl bg-[var(--accent)] px-5 py-4 text-white shadow">
        <div className="text-sm opacity-80">{t.statsTotal}</div>
        <div className="mt-1 text-3xl font-bold tabular-nums">
          {formatCents(total, base, intl)}
        </div>
      </section>

      <Section title={t.statsSpending}>
        {snapshot.members.map((member) => {
          const stats = memberStats.get(member.id);
          if (!stats) return null;
          return (
            <div key={member.id} className="px-4 py-2.5">
              <div className="flex justify-between text-sm">
                <span className="font-medium">{member.name}</span>
                <span className="tabular-nums font-semibold">
                  {formatCents(stats.paid, base, intl)}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                <div
                  className="h-full rounded-full bg-[var(--accent)]"
                  style={{ width: `${(stats.paid / maxPaid) * 100}%` }}
                />
              </div>
            </div>
          );
        })}
      </Section>

      <Section title={t.statsShare}>
        {snapshot.members.map((member) => {
          const stats = memberStats.get(member.id);
          if (!stats) return null;
          return (
            <div key={member.id} className="flex justify-between px-4 py-2.5 text-sm">
              <span className="font-medium">{member.name}</span>
              <span className="tabular-nums">{formatCents(stats.owedShare, base, intl)}</span>
            </div>
          );
        })}
      </Section>

      <Section title={t.statsCategories}>
        {CATEGORIES.filter((c) => categoryStats.has(c)).map((category) => (
          <div key={category} className="flex justify-between px-4 py-2.5 text-sm">
            <span className="font-medium">
              {CATEGORY_EMOJI[category as CategoryKey]} {categoryLabel(t, category as CategoryKey)}
            </span>
            <span className="tabular-nums">
              {formatCents(categoryStats.get(category) ?? 0, base, intl)}
            </span>
          </div>
        ))}
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">{title}</h2>
      <div className="mt-2 divide-y divide-neutral-100 rounded-2xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
        {children}
      </div>
    </section>
  );
}
