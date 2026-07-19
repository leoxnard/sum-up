import { Link } from "react-router";
import { useMemo } from "react";

import { useGroup } from "./group";
import { useT } from "../root";
import { computeBalances } from "../lib/balances";
import { formatCents, toBaseCents } from "../lib/money";
import { CATEGORY_EMOJI } from "../lib/categories";
import type { Entry } from "../lib/types";

export default function GroupOverview() {
  const { snapshot, me } = useGroup();
  const { t, intl } = useT();
  const base = snapshot.group.baseCurrency;
  const balances = useMemo(() => computeBalances(snapshot), [snapshot]);
  const memberName = new Map(snapshot.members.map((m) => [m.id, m.name]));
  const myBalance = me ? (balances.get(me) ?? 0) : null;

  return (
    <main className="px-4 pb-28 pt-6">
      <header className="flex items-center justify-between">
        <h1 className="truncate text-2xl font-bold">{snapshot.group.name}</h1>
        <div className="flex gap-1">
          <IconLink to="stats" label={t.stats} icon="📊" />
          <IconLink to="settings" label={t.settings} icon="⚙️" />
        </div>
      </header>

      {myBalance !== null && me && memberName.has(me) && (
        <section className="mt-4 rounded-2xl bg-[var(--accent)] px-5 py-4 text-white shadow">
          <div className="text-sm/none opacity-80">{t.yourBalance}</div>
          <div className="mt-1.5 text-3xl font-bold tabular-nums">
            {formatCents(myBalance, base, intl)}
          </div>
          <div className="mt-1 text-sm opacity-80">
            {myBalance > 0 ? t.youAreOwed : myBalance < 0 ? t.youOwe : t.allSettled}
          </div>
        </section>
      )}

      <section className="mt-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          {t.balances}
        </h2>
        <div className="mt-2 overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          {snapshot.members.map((member) => {
            const balance = balances.get(member.id) ?? 0;
            return (
              <div
                key={member.id}
                className="flex items-center justify-between border-b border-neutral-100 px-4 py-2.5 last:border-b-0 dark:border-neutral-800"
              >
                <span className="font-medium">{member.name}</span>
                <span
                  className={`tabular-nums text-sm font-semibold ${
                    balance > 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : balance < 0
                        ? "text-rose-600 dark:text-rose-400"
                        : "text-neutral-400"
                  }`}
                >
                  {formatCents(balance, base, intl)}
                </span>
              </div>
            );
          })}
        </div>
        <Link
          to="settle"
          className="mt-3 block rounded-xl border border-[var(--accent)] px-4 py-2.5 text-center font-semibold text-[var(--accent)]"
        >
          {t.settleUp}
        </Link>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          {t.entries}
        </h2>
        {snapshot.entries.length === 0 ? (
          <p className="mt-3 text-neutral-500">{t.noEntriesYet}</p>
        ) : (
          <EntryList entries={snapshot.entries} memberName={memberName} base={base} />
        )}
      </section>

      <nav className="fixed inset-x-0 bottom-0 mx-auto flex max-w-lg gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
        <Link
          to="new-payment"
          className="flex-1 rounded-2xl border border-neutral-300 bg-white px-4 py-3.5 text-center font-semibold shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        >
          {t.addPayment}
        </Link>
        <Link
          to="new-expense"
          className="flex-[2] rounded-2xl bg-[var(--accent)] px-4 py-3.5 text-center font-semibold text-white shadow-lg"
        >
          + {t.addExpense}
        </Link>
      </nav>
    </main>
  );
}

function IconLink({ to, label, icon }: { to: string; label: string; icon: string }) {
  return (
    <Link to={to} aria-label={label} className="rounded-full p-2 text-xl">
      {icon}
    </Link>
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
    <div className="mt-2 flex flex-col gap-1.5">
      {entries.map((entry) => {
        const showDate = entry.expenseDate !== lastDate;
        lastDate = entry.expenseDate;
        const foreign = entry.currency !== base;
        return (
          <div key={entry.id}>
            {showDate && (
              <div className="mb-1 mt-3 text-xs font-medium text-neutral-400">
                {dateFormat.format(new Date(`${entry.expenseDate}T12:00:00`))}
              </div>
            )}
            <Link
              to={`entry/${entry.id}`}
              className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-3.5 py-3 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <span className="text-xl">
                {entry.kind === "payment" ? "💸" : CATEGORY_EMOJI[entry.category ?? "other"]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {entry.kind === "payment"
                    ? `${memberName.get(entry.payerId) ?? "?"} → ${memberName.get(entry.recipientId ?? "") ?? "?"}`
                    : entry.title}
                </span>
                <span className="block truncate text-xs text-neutral-500">
                  {entry.kind === "payment"
                    ? t.payment
                    : `${t.paidBy} ${memberName.get(entry.payerId) ?? "?"}`}
                </span>
              </span>
              <span className="text-right">
                <span className="block font-semibold tabular-nums">
                  {formatCents(entry.amountCents, entry.currency, intl)}
                </span>
                {foreign && (
                  <span className="block text-xs tabular-nums text-neutral-400">
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
