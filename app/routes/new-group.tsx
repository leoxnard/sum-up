import { useNavigate } from "react-router";
import { useState } from "react";

import type { Route } from "./+types/new-group";
import { useT } from "../root";
import { CURRENCIES } from "../lib/currencies";
import { randomAccent } from "../lib/accent";
import { submitOp } from "../lib/client/outbox";
import { rememberDeviceGroup, saveSnapshot } from "../lib/client/idb";
import { writeClaim } from "../lib/client/claim";
import { Sheet, useDismiss } from "../components/overlays";
import { IconPlus } from "../components/icons";
import type { GroupSnapshot } from "../lib/types";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Sum Up" }];
}

function randomSlug(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

export default function NewGroup() {
  const { t } = useT();
  return (
    <Sheet backTo="/" label={t.createGroup}>
      <NewGroupFields />
    </Sheet>
  );
}

function NewGroupFields() {
  const { t } = useT();
  const navigate = useNavigate();
  const dismiss = useDismiss();
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [memberNames, setMemberNames] = useState<string[]>(["", ""]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function create() {
    const trimmedName = name.trim();
    const members = memberNames.map((m) => m.trim()).filter(Boolean);
    if (!trimmedName || members.length === 0) {
      setError(t.errNoTitle);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createGroup(trimmedName, members);
    } catch {
      // Every step below writes to IndexedDB first. If that is unavailable the
      // group would silently never appear — say so instead of doing nothing.
      setError(t.storageUnavailable);
      setSaving(false);
    }
  }

  async function createGroup(trimmedName: string, members: string[]) {
    const now = Date.now();
    const groupId = crypto.randomUUID();
    const slug = randomSlug();
    const accentColor = randomAccent();
    const memberRecords = members.map((memberName) => ({
      id: crypto.randomUUID(),
      name: memberName,
      updatedAt: now,
    }));

    // Seed the local mirror first: the group must open instantly, even offline.
    const snapshot: GroupSnapshot = {
      group: { id: groupId, slug, name: trimmedName, baseCurrency: currency, accentColor, updatedAt: now },
      members: memberRecords,
      entries: [],
      fetchedAt: now,
    };
    await saveSnapshot(snapshot);
    await rememberDeviceGroup({
      slug,
      name: trimmedName,
      accentColor,
      baseCurrency: currency,
      lastOpenedAt: now,
    });
    writeClaim(groupId, memberRecords[0].id);

    await submitOp({
      op: "upsert_group",
      slug,
      clientUpdatedAt: now,
      group: { id: groupId, name: trimmedName, baseCurrency: currency, accentColor },
    });
    for (const member of memberRecords) {
      await submitOp({
        op: "upsert_member",
        slug,
        clientUpdatedAt: now,
        groupId,
        member: { id: member.id, name: member.name },
      });
    }
    navigate(`/g/${slug}`);
  }

  return (
    <>
      <header className="sheet-head">
        <button
          type="button"
          onClick={dismiss}
          className="-ml-1 shrink-0 px-1 py-1 text-[0.9375rem] font-semibold text-[var(--text-2)]"
        >
          {t.cancel}
        </button>
        <h2 className="min-w-0 flex-1 truncate text-center text-base font-bold">
          {t.createGroup}
        </h2>
        <button
          onClick={() => void create()}
          disabled={saving}
          className="btn btn-primary h-9 shrink-0 rounded-2xl px-4 text-sm"
        >
          {saving ? t.loading : t.create}
        </button>
      </header>

      <div className="sheet-body flex flex-col gap-5 pt-5">
        <div>
          <Label>{t.groupName}</Label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.groupNamePlaceholder}
            className="input"
            autoFocus
          />
        </div>

        <div>
          <Label>{t.baseCurrency}</Label>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="input">
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-[var(--text-2)]">{t.baseCurrencyHint}</p>
        </div>

        <div>
          <Label>{t.members}</Label>
          <div className="flex flex-col gap-2">
            {memberNames.map((value, index) => (
              <input
                key={index}
                value={value}
                onChange={(e) => {
                  const next = [...memberNames];
                  next[index] = e.target.value;
                  setMemberNames(next);
                }}
                placeholder={`${t.memberName} ${index + 1}`}
                className={`input ${index >= 2 ? "animate-pop" : ""}`}
              />
            ))}
          </div>
          <button
            onClick={() => setMemberNames([...memberNames, ""])}
            className="btn btn-ghost mt-2 -ml-3 text-[var(--accent)]"
          >
            <IconPlus className="size-[1.05em]" />
            {t.addMember}
          </button>
        </div>

        {error && (
          <p
            className="animate-pop rounded-2xl px-3.5 py-2.5 text-sm font-semibold"
            style={{
              color: "var(--neg)",
              background: "color-mix(in oklab, var(--neg) 12%, transparent)",
            }}
          >
            {error}
          </p>
        )}

        <p className="text-[0.71875rem] leading-relaxed text-[var(--text-3)]">
          {t.credentialNote}
        </p>
      </div>
    </>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="section-label mb-2">{children}</div>;
}
