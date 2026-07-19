import { Link, useNavigate } from "react-router";
import { useMemo } from "react";

import { useGroup } from "./group";
import { useT } from "../root";
import { computeBalances, suggestSettlement } from "../lib/balances";
import { formatCents } from "../lib/money";
import { submitOp } from "../lib/client/outbox";

export default function Settle() {
  const { snapshot } = useGroup();
  const { t, intl } = useT();
  const navigate = useNavigate();
  const base = snapshot.group.baseCurrency;
  const memberName = new Map(snapshot.members.map((m) => [m.id, m.name]));
  const transfers = useMemo(
    () => suggestSettlement(computeBalances(snapshot)),
    [snapshot],
  );

  async function record(fromId: string, toId: string, amountCents: number) {
    await submitOp({
      op: "upsert_entry",
      slug: snapshot.group.slug,
      clientUpdatedAt: Date.now(),
      groupId: snapshot.group.id,
      entry: {
        id: crypto.randomUUID(),
        kind: "payment",
        title: null,
        note: null,
        category: null,
        categorySource: null,
        payerId: fromId,
        recipientId: toId,
        amountCents,
        currency: base,
        exchangeRate: 1,
        splitMode: "equal",
        expenseDate: new Date().toISOString().slice(0, 10),
        shares: [],
      },
    });
    navigate(`/g/${snapshot.group.slug}`);
  }

  return (
    <main className="px-4 pb-16 pt-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{t.settleTitle}</h1>
        <Link to={`/g/${snapshot.group.slug}`} className="text-sm text-neutral-500">
          {t.cancel}
        </Link>
      </header>

      {transfers.length === 0 ? (
        <p className="mt-8 text-center text-neutral-500">{t.settleEmpty}</p>
      ) : (
        <>
          <p className="mt-4 text-sm text-neutral-500">{t.settleHint}</p>
          <div className="mt-3 flex flex-col gap-2">
            {transfers.map((transfer, index) => (
              <div
                key={index}
                className="flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900"
              >
                <div className="min-w-0 flex-1">
                  <span className="font-semibold">{memberName.get(transfer.fromId) ?? "?"}</span>{" "}
                  <span className="text-neutral-500">{t.pays}</span>{" "}
                  <span className="font-semibold">{memberName.get(transfer.toId) ?? "?"}</span>
                  <div className="text-lg font-bold tabular-nums text-[var(--accent)]">
                    {formatCents(transfer.amountCents, base, intl)}
                  </div>
                </div>
                <button
                  onClick={() => void record(transfer.fromId, transfer.toId, transfer.amountCents)}
                  className="rounded-xl bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white"
                >
                  {t.recordPayment}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
