import { Link } from "react-router";
import { useMemo } from "react";

import { useGroup } from "./group";
import { useT } from "../root";
import { computeBalances } from "../lib/balances";
import { formatCents } from "../lib/money";

/**
 * The Overview tab answers one question — where do I stand — and hands off
 * everything else. The entry history lives one tab across, in Activity, so this
 * screen stays readable at a glance instead of scrolling past the answer.
 */
export default function GroupOverview() {
  const { snapshot, me } = useGroup();
  const { t, intl } = useT();
  const base = snapshot.group.baseCurrency;
  const balances = useMemo(() => computeBalances(snapshot), [snapshot]);
  const myBalance = me ? (balances.get(me) ?? 0) : null;
  const isMember = !!me && snapshot.members.some((m) => m.id === me);

  return (
    <main className="pt-2">
      <section className="animate-rise text-center">
        <p className="text-[0.78125rem] text-[var(--text-2)]">
          {snapshot.members.map((m) => m.name).join(", ")} · {base}
        </p>
        {isMember && myBalance !== null && (
          <>
            <h2 className="section-label mt-6">{t.yourBalance}</h2>
            <p
              className="num mt-2 text-[3.5rem] leading-none tracking-[-0.035em]"
              style={{
                color:
                  myBalance > 0
                    ? "var(--accent)"
                    : myBalance < 0
                      ? "var(--neg)"
                      : "var(--text-2)",
              }}
            >
              {formatCents(myBalance, base, intl)}
            </p>
            <p className="mt-2.5 text-[0.84375rem] text-[var(--text-2)]">
              {myBalance > 0 ? t.youAreOwed : myBalance < 0 ? t.youOwe : t.allSettled}
            </p>
          </>
        )}
      </section>

      <section className="animate-rise mt-7" style={{ animationDelay: "60ms" }}>
        <h2 className="section-label">{t.balances}</h2>
        <div className="glass glass-list mt-2.5">
          {snapshot.members.map((member) => {
            const balance = balances.get(member.id) ?? 0;
            return (
              <div key={member.id} className="glass-row">
                <span
                  aria-hidden
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--bar-track)] text-[0.78125rem] font-bold"
                >
                  {[...member.name][0]?.toUpperCase() ?? "?"}
                </span>
                <span className="min-w-0 flex-1 truncate font-semibold">{member.name}</span>
                <span
                  className="num shrink-0 text-[0.9375rem]"
                  style={{
                    color:
                      balance > 0
                        ? "var(--accent)"
                        : balance < 0
                          ? "var(--neg)"
                          : "var(--text-2)",
                  }}
                >
                  {formatCents(balance, base, intl)}
                </span>
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex gap-2.5">
          <Link to="settle" className="btn btn-neutral btn-lg flex-1">
            {t.settleUp}
          </Link>
          <Link to="new-payment" className="btn btn-neutral btn-lg flex-1">
            {t.addPayment}
          </Link>
        </div>
      </section>
    </main>
  );
}
