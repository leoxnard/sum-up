import { Link, useNavigate, useRevalidator } from "react-router";
import { useState } from "react";

import { useGroup } from "./group";
import { useT } from "../root";
import { ACCENTS, ACCENT_KEYS, type AccentKey } from "../lib/accent";
import { LOCALES, LOCALE_LABELS, type Locale } from "../lib/i18n";
import { submitOp } from "../lib/client/outbox";
import { forgetDeviceGroup } from "../lib/client/idb";
import { readClaim, writeClaim } from "../lib/client/claim";

export default function Settings() {
  const { snapshot } = useGroup();
  const { t, locale } = useT();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const group = snapshot.group;

  const [name, setName] = useState(group.name);
  const [newMember, setNewMember] = useState("");
  const [copied, setCopied] = useState(false);

  const usedMemberIds = new Set<string>();
  for (const entry of snapshot.entries) {
    usedMemberIds.add(entry.payerId);
    if (entry.recipientId) usedMemberIds.add(entry.recipientId);
    for (const share of entry.shares) usedMemberIds.add(share.memberId);
  }

  function saveGroup(next: { name?: string; accentColor?: string }) {
    void submitOp({
      op: "upsert_group",
      slug: group.slug,
      clientUpdatedAt: Date.now(),
      group: {
        id: group.id,
        name: next.name ?? name,
        baseCurrency: group.baseCurrency,
        accentColor: next.accentColor ?? group.accentColor,
      },
    });
  }

  async function addMember() {
    const trimmed = newMember.trim();
    if (!trimmed) return;
    await submitOp({
      op: "upsert_member",
      slug: group.slug,
      clientUpdatedAt: Date.now(),
      groupId: group.id,
      member: { id: crypto.randomUUID(), name: trimmed },
    });
    setNewMember("");
  }

  function renameMember(memberId: string, currentName: string) {
    const next = prompt(t.renameMember, currentName)?.trim();
    if (!next || next === currentName) return;
    void submitOp({
      op: "upsert_member",
      slug: group.slug,
      clientUpdatedAt: Date.now(),
      groupId: group.id,
      member: { id: memberId, name: next },
    });
  }

  function removeMember(memberId: string) {
    void submitOp({
      op: "delete_member",
      slug: group.slug,
      clientUpdatedAt: Date.now(),
      groupId: group.id,
      memberId,
    });
    if (readClaim(group.id) === memberId) writeClaim(group.id, "");
  }

  async function deleteGroup() {
    if (!confirm(t.deleteGroupConfirm)) return;
    await submitOp({
      op: "delete_group",
      slug: group.slug,
      clientUpdatedAt: Date.now(),
      groupId: group.id,
    });
    await forgetDeviceGroup(group.slug);
    navigate("/");
  }

  function switchLocale(next: Locale) {
    document.cookie = `sumup_locale=${next}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
    revalidator.revalidate();
  }

  const inviteUrl =
    typeof window !== "undefined" ? `${window.location.origin}/g/${group.slug}` : `/g/${group.slug}`;

  return (
    <main className="px-4 pb-16 pt-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{t.settings}</h1>
        <Link to={`/g/${group.slug}`} className="text-sm text-neutral-500">
          {t.cancel}
        </Link>
      </header>

      <div className="mt-5 flex flex-col gap-6">
        <section>
          <Label>{t.groupName}</Label>
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
            <button
              onClick={() => name.trim() && saveGroup({ name: name.trim() })}
              className="rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-white"
            >
              {t.saveChanges}
            </button>
          </div>
        </section>

        <section>
          <Label>{t.accentColor}</Label>
          <div className="flex flex-wrap gap-2.5">
            {ACCENT_KEYS.map((key: AccentKey) => (
              <button
                key={key}
                aria-label={key}
                onClick={() => saveGroup({ accentColor: key })}
                className={`size-9 rounded-full border-2 ${
                  group.accentColor === key
                    ? "border-neutral-900 dark:border-white"
                    : "border-transparent"
                }`}
                style={{ backgroundColor: ACCENTS[key].strong }}
              />
            ))}
          </div>
        </section>

        <section>
          <Label>{t.inviteLink}</Label>
          <p className="mb-2 text-xs text-neutral-500">{t.inviteHint}</p>
          <div className="flex gap-2">
            <input readOnly value={inviteUrl} className={`${inputClass} text-xs`} />
            <button
              onClick={() => {
                void navigator.clipboard.writeText(inviteUrl).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
              className="whitespace-nowrap rounded-xl border border-[var(--accent)] px-3 text-sm font-semibold text-[var(--accent)]"
            >
              {copied ? t.linkCopied : t.copyLink}
            </button>
          </div>
        </section>

        <section>
          <Label>{t.members}</Label>
          <div className="divide-y divide-neutral-100 overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
            {snapshot.members.map((member) => (
              <div key={member.id} className="flex items-center gap-2 px-4 py-2.5">
                <span className="min-w-0 flex-1 truncate font-medium">{member.name}</span>
                <button
                  onClick={() => renameMember(member.id, member.name)}
                  className="text-xs text-neutral-500"
                >
                  {t.renameMember}
                </button>
                {usedMemberIds.has(member.id) ? (
                  <span className="text-xs text-neutral-300 dark:text-neutral-600" title={t.memberInUse}>
                    {t.removeMember}
                  </span>
                ) : (
                  <button
                    onClick={() => removeMember(member.id)}
                    className="text-xs text-rose-600"
                  >
                    {t.removeMember}
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              value={newMember}
              onChange={(e) => setNewMember(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void addMember()}
              placeholder={t.memberName}
              className={inputClass}
            />
            <button
              onClick={() => void addMember()}
              className="whitespace-nowrap rounded-xl border border-[var(--accent)] px-3 text-sm font-semibold text-[var(--accent)]"
            >
              {t.addMember}
            </button>
          </div>
        </section>

        <section>
          <Label>{t.language}</Label>
          <div className="flex gap-2">
            {LOCALES.map((l) => (
              <button
                key={l}
                onClick={() => switchLocale(l)}
                className={`rounded-xl px-4 py-2 text-sm font-semibold ${
                  locale === l
                    ? "bg-[var(--accent)] text-white"
                    : "border border-neutral-300 dark:border-neutral-700"
                }`}
              >
                {LOCALE_LABELS[l]}
              </button>
            ))}
          </div>
        </section>

        <section>
          <a
            href={`/g/${group.slug}/export.csv`}
            className="block rounded-xl border border-neutral-300 px-4 py-2.5 text-center text-sm font-semibold dark:border-neutral-700"
          >
            ⬇️ {t.exportCsv}
          </a>
        </section>

        <section className="border-t border-neutral-200 pt-4 dark:border-neutral-800">
          <button onClick={() => void deleteGroup()} className="text-sm font-semibold text-rose-600">
            {t.deleteGroup}
          </button>
        </section>
      </div>
    </main>
  );
}

const inputClass =
  "w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 dark:border-neutral-700 dark:bg-neutral-900";

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-sm font-semibold text-neutral-600 dark:text-neutral-300">
      {children}
    </div>
  );
}
