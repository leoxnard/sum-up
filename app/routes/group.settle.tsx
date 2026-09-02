import { useMemo } from "react";

import { useGroup } from "./group";
import { useT } from "../root";
import { computeBalances, suggestSettlement } from "../lib/balances";
import { formatCents } from "../lib/money";
import { submitOp } from "../lib/client/outbox";
import { PushPanel, useDismiss } from "../components/overlays";
import { IconArrowRight, IconCheck } from "../components/icons";

export default function Settle() {
  const { snapshot } = useGroup();
  const { t } = useT();
  return (
    <PushPanel backTo={`/g/${snapshot.group.slug}`} title={t.settleTitle}>
      <SettleBody />
    </PushPanel>
  );
}

function SettleBody() {
  const { snapshot } = useGroup();
  const { t, intl } = useT();
  const dismiss = useDismiss();
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
    dismiss();
  }

  if (transfers.length === 0) {
    return (
      <div className="animate-pop mt-8 flex flex-col items-center gap-3 text-center">
        <span className="glyph size-14 rounded-2xl">
          <IconCheck className="size-7" />
        </span>
        <p className="text-[var(--text-2)]">{t.settleEmpty}</p>
      </div>
    );
  }

  return (
    <>
      <p className="text-[0.84375rem] text-[var(--text-2)]">{t.settleHint}</p>
      <div className="stagger mt-4 flex flex-col gap-2.5">
        {transfers.map((transfer, index) => (
          <div
            key={index}
            style={{ "--i": index } as React.CSSProperties}
            className="glass flex items-center gap-3 px-[1.125rem] py-4"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-[0.4375rem] text-sm font-bold">
                <span className="truncate">{memberName.get(transfer.fromId) ?? "?"}</span>
                <span className="sr-only">{t.pays}</span>
                <IconArrowRight className="size-3.5 shrink-0 text-[var(--text-2)]" />
                <span className="truncate">{memberName.get(transfer.toId) ?? "?"}</span>
              </div>
              <div className="num mt-1.5 text-[1.3125rem] text-[var(--accent)]">
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
  );
}
