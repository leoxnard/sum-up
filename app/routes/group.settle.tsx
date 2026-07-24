import { Link, useNavigate } from "react-router";
import { useMemo } from "react";

import { useGroup } from "./group";
import { useT } from "../root";
import { computeBalances, suggestSettlement } from "../lib/balances";
import { formatCents } from "../lib/money";
import { submitOp } from "../lib/client/outbox";
import { IconArrowRight, IconCheck } from "../components/icons";

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
    <main className="animate-rise px-4 pb-16 pt-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">{t.settleTitle}</h1>
        <Link to={`/g/${snapshot.group.slug}`} className="btn btn-ghost -mr-3">
          {t.cancel}
        </Link>
      </header>

      {transfers.length === 0 ? (
        <div className="animate-pop mt-8 flex flex-col items-center gap-3 text-center">
          <span className="glyph size-14 rounded-2xl">
            <IconCheck className="size-7" />
          </span>
          <p className="text-[var(--text-muted)]">{t.settleEmpty}</p>
        </div>
      ) : (
        <>
          <p className="mt-4 text-sm text-[var(--text-muted)]">{t.settleHint}</p>
          <div className="stagger mt-3 flex flex-col gap-2">
            {transfers.map((transfer, index) => (
              <div
                key={index}
                style={{ "--i": index } as React.CSSProperties}
                className="card flex items-center gap-3 px-4 py-3.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-sm">
                    <span className="truncate font-semibold">
                      {memberName.get(transfer.fromId) ?? "?"}
                    </span>
                    <span className="sr-only">{t.pays}</span>
                    <IconArrowRight className="size-3.5 shrink-0 text-[var(--text-muted)]" />
                    <span className="truncate font-semibold">
                      {memberName.get(transfer.toId) ?? "?"}
                    </span>
                  </div>
                  <div className="mt-1 text-xl font-bold tabular-nums text-[var(--accent)]">
                    {formatCents(transfer.amountCents, base, intl)}
                  </div>
                </div>
                <button
                  onClick={() => void record(transfer.fromId, transfer.toId, transfer.amountCents)}
                  className="btn btn-primary shrink-0"
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
