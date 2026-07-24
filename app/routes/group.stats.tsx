import { Link } from "react-router";
import { useMemo } from "react";

import { useGroup } from "./group";
import { useT } from "../root";
import { computeCategoryStats, computeMemberStats } from "../lib/balances";
import { formatCents, toBaseCents } from "../lib/money";
import { CATEGORIES } from "../lib/categories";
import { CategoryIcon } from "../components/icons";
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
            <div key={member.id} className="px-4 py-3">
              <div className="flex justify-between text-sm">
                <span className="font-medium">{member.name}</span>
                <span className="font-semibold tabular-nums">
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
          );
        })}
      </Section>

      <Section title={t.statsShare}>
        {snapshot.members.map((member) => {
          const stats = memberStats.get(member.id);
          if (!stats) return null;
          return (
            <div key={member.id} className="flex justify-between px-4 py-3 text-sm">
              <span className="font-medium">{member.name}</span>
              <span className="tabular-nums">{formatCents(stats.owedShare, base, intl)}</span>
            </div>
          );
        })}
      </Section>

      <Section title={t.statsCategories}>
        {CATEGORIES.filter((c) => categoryStats.has(c)).map((category) => (
          <div key={category} className="flex items-center justify-between px-4 py-2.5 text-sm">
            <span className="flex items-center gap-2.5 font-medium">
              <span className="glyph size-8 rounded-lg">
                <CategoryIcon category={category as CategoryKey} className="size-4" />
              </span>
              {categoryLabel(t, category as CategoryKey)}
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
      <h2 className="section-label">{title}</h2>
      <div className="card row-divider mt-2.5 overflow-hidden">{children}</div>
    </section>
  );
}
