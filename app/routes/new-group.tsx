import { Link, useNavigate } from "react-router";
import { useState } from "react";

import type { Route } from "./+types/new-group";
import { useT } from "../root";
import { CURRENCIES } from "../lib/currencies";
import { randomAccent } from "../lib/accent";
import { submitOp } from "../lib/client/outbox";
import { rememberDeviceGroup, saveSnapshot } from "../lib/client/idb";
import { writeClaim } from "../lib/client/claim";
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
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [memberNames, setMemberNames] = useState<string[]>(["", ""]);
  const [error, setError] = useState(false);

  async function create() {
    const trimmedName = name.trim();
    const members = memberNames.map((m) => m.trim()).filter(Boolean);
    if (!trimmedName || members.length === 0) {
      setError(true);
      return;
    }
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
    <main className="animate-rise mx-auto min-h-dvh max-w-lg px-4 pb-16 pt-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{t.createGroup}</h1>
        <Link to="/" className="btn btn-ghost -mr-3">{t.cancel}</Link>
      </header>

      <div className="mt-6 flex flex-col gap-5">
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
          <p className="mt-1.5 text-xs text-[var(--text-muted)]">{t.baseCurrencyHint}</p>
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
          <p className="animate-pop rounded-xl bg-rose-500/10 px-3.5 py-2.5 text-sm font-medium text-rose-600 dark:text-rose-400">
            {t.errNoTitle}
          </p>
        )}

        <button onClick={() => void create()} className="btn btn-primary btn-lg">
          {t.create}
        </button>
      </div>
    </main>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-sm font-medium text-[var(--text-muted)]">
      {children}
    </div>
  );
}
