import { Link } from "react-router";
import { useMemo } from "react";

import { useGroup } from "./group";
import { useT } from "../root";
import { computeBalances } from "../lib/balances";
import { formatCents, toBaseCents } from "../lib/money";
import {
  EntryIcon,
  IconArrowLeft,
  IconChart,
  IconPlus,
  IconSliders,
} from "../components/icons";
import type { Entry } from "../lib/types";

export default function GroupOverview() {
  const { snapshot, me } = useGroup();
  const { t, intl } = useT();
  const base = snapshot.group.baseCurrency;
  const balances = useMemo(() => computeBalances(snapshot), [snapshot]);
  const memberName = new Map(snapshot.members.map((m) => [m.id, m.name]));
  const myBalance = me ? (balances.get(me) ?? 0) : null;

  return (
    <main className="px-4 pb-32 pt-6">
      <header className="animate-rise flex items-center gap-1">
        <Link to="/" aria-label={t.backHome} className="btn-icon -ml-2.5 shrink-0">
          <IconArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-2xl font-bold tracking-tight">
          {snapshot.group.name}
        </h1>
        <div className="flex shrink-0 gap-0.5">
          <Link to="stats" aria-label={t.stats} className="btn-icon">
            <IconChart className="size-5" />
          </Link>
          <Link to="settings" aria-label={t.settings} className="btn-icon">
            <IconSliders className="size-5" />
          </Link>
        </div>
      </header>

      {myBalance !== null && me && memberName.has(me) && (
        <section
          className="animate-rise relative mt-5 overflow-hidden rounded-[var(--radius-card)] px-5 py-5 text-white"
          style={{
            background:
              "linear-gradient(135deg, color-mix(in oklab, var(--accent) 88%, white) 0%, var(--accent) 55%, color-mix(in oklab, var(--accent) 80%, black) 100%)",
            boxShadow: "var(--shadow-pop)",
            animationDelay: "60ms",
          }}
        >
          {/* Soft highlight so the card reads as a surface, not a flat swatch. */}
          <span
            aria-hidden
            className="pointer-events-none absolute -right-10 -top-16 size-44 rounded-full bg-white/15 blur-2xl"
          />
          <div className="text-sm/none font-medium opacity-75">{t.yourBalance}</div>
          <div className="mt-2 text-[2.15rem] font-bold leading-none tabular-nums">
            {formatCents(myBalance, base, intl)}
          </div>
          <div className="mt-2 text-sm opacity-80">
            {myBalance > 0 ? t.youAreOwed : myBalance < 0 ? t.youOwe : t.allSettled}
          </div>
        </section>
      )}

      <section className="mt-7">
        <h2 className="section-label">{t.balances}</h2>
        <div className="card row-divider mt-2.5 overflow-hidden">
          {snapshot.members.map((member) => {
            const balance = balances.get(member.id) ?? 0;
            return (
              <div
                key={member.id}
                className="flex items-center justify-between px-4 py-3"
              >
                <span className="font-medium">{member.name}</span>
                <span
                  className={`text-sm font-semibold tabular-nums ${
                    balance > 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : balance < 0
                        ? "text-rose-600 dark:text-rose-400"
                        : "text-[var(--text-muted)]"
                  }`}
                >
                  {formatCents(balance, base, intl)}
                </span>
              </div>
            );
          })}
        </div>
        <Link to="settle" className="btn btn-outline mt-3 w-full">
          {t.settleUp}
        </Link>
      </section>

      <section className="mt-7">
        <h2 className="section-label">{t.entries}</h2>
        {snapshot.entries.length === 0 ? (
          <p className="card mt-2.5 px-4 py-8 text-center text-sm text-[var(--text-muted)]">
            {t.noEntriesYet}
          </p>
        ) : (
          <EntryList entries={snapshot.entries} memberName={memberName} base={base} />
        )}
      </section>

      <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-10">
        {/* Fade the content out behind the floating action bar. */}
        <div
          aria-hidden
          className="h-10 bg-gradient-to-t from-[var(--page)] to-transparent"
        />
        <div className="pointer-events-auto mx-auto flex max-w-lg gap-2 bg-[var(--page)] px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Link to="new-payment" className="btn btn-neutral btn-lg flex-1">
            {t.addPayment}
          </Link>
          <Link to="new-expense" className="btn btn-primary btn-lg flex-[1.6]">
            <IconPlus className="size-[1.1em]" />
            {t.addExpense}
          </Link>
        </div>
      </nav>
    </main>
  );
}

function EntryList({
  entries,
  memberName,
  base,
}: {
  entries: Entry[];
  memberName: Map<string, string>;
  base: string;
}) {
  const { t, intl } = useT();
  const dateFormat = new Intl.DateTimeFormat(intl, { dateStyle: "medium" });
  let lastDate = "";
  return (
    <div className="stagger mt-2.5 flex flex-col gap-1.5">
      {entries.map((entry, index) => {
        const showDate = entry.expenseDate !== lastDate;
        lastDate = entry.expenseDate;
        const foreign = entry.currency !== base;
        return (
          <div key={entry.id} style={{ "--i": Math.min(index, 12) } as React.CSSProperties}>
            {showDate && (
              <div className="mb-1.5 mt-4 text-xs font-semibold text-[var(--text-muted)]">
                {dateFormat.format(new Date(`${entry.expenseDate}T12:00:00`))}
              </div>
            )}
            <Link
              to={`entry/${entry.id}`}
              className="card pressable flex items-center gap-3 px-3 py-2.5"
            >
              <span className="glyph">
                <EntryIcon
                  kind={entry.kind}
                  category={entry.category}
                  className="size-[1.15rem]"
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {entry.kind === "payment"
                    ? `${memberName.get(entry.payerId) ?? "?"} → ${memberName.get(entry.recipientId ?? "") ?? "?"}`
                    : entry.title}
                </span>
                <span className="block truncate text-xs text-[var(--text-muted)]">
                  {entry.kind === "payment"
                    ? t.payment
                    : `${t.paidBy} ${memberName.get(entry.payerId) ?? "?"}`}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-semibold tabular-nums">
                  {formatCents(entry.amountCents, entry.currency, intl)}
                </span>
                {foreign && (
                  <span className="block text-xs tabular-nums text-[var(--text-muted)]">
                    {formatCents(toBaseCents(entry.amountCents, entry.exchangeRate), base, intl)}
                  </span>
                )}
              </span>
            </Link>
          </div>
        );
      })}
    </div>
  );
}
