import { Link, useNavigate, useRevalidator } from "react-router";
import { useState } from "react";

import { useGroup } from "./group";
import { useT } from "../root";
import { ACCENTS, ACCENT_KEYS, type AccentKey } from "../lib/accent";
import { LOCALES, LOCALE_LABELS, type Locale } from "../lib/i18n";
import { submitOp } from "../lib/client/outbox";
import { forgetDeviceGroup } from "../lib/client/idb";
import { readClaim, writeClaim } from "../lib/client/claim";
import {
  IconCheck,
  IconCopy,
  IconDownload,
  IconPlus,
  IconShare,
  IconTrash,
} from "../components/icons";

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

  function copyInvite() {
    void navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  // Native share sheet where supported (mobile Safari/Chrome); desktop
  // browsers mostly don't implement navigator.share at all, so fall back to
  // the same copy-to-clipboard behavior as the Copy button.
  async function shareInvite() {
    if (navigator.share) {
      try {
        await navigator.share({ title: group.name, url: inviteUrl });
        return;
      } catch {
        return; // user cancelled the share sheet — don't fall back to copy
      }
    }
    copyInvite();
  }

  return (
    <main className="animate-rise px-4 pb-16 pt-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">{t.settings}</h1>
        <Link to={`/g/${group.slug}`} className="btn btn-ghost -mr-3">
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
              className="input"
            />
            <button
              onClick={() => name.trim() && saveGroup({ name: name.trim() })}
              className="btn btn-primary"
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
                aria-pressed={group.accentColor === key}
                onClick={() => saveGroup({ accentColor: key })}
                className={`grid size-9 place-items-center rounded-full text-white transition-transform duration-200 ease-[var(--ease-out)] hover:scale-110 active:scale-95 ${
                  group.accentColor === key ? "scale-110 ring-2 ring-offset-2" : ""
                }`}
                style={{
                  backgroundColor: ACCENTS[key].strong,
                  ...(group.accentColor === key
                    ? ({
                        "--tw-ring-color": ACCENTS[key].strong,
                        "--tw-ring-offset-color": "var(--page)",
                      } as React.CSSProperties)
                    : {}),
                }}
              >
                {group.accentColor === key && <IconCheck className="animate-pop size-4" />}
              </button>
            ))}
          </div>
        </section>

        <section>
          <Label>{t.inviteLink}</Label>
          <p className="mb-2 text-xs text-[var(--text-muted)]">{t.inviteHint}</p>
          <div className="flex gap-2">
            <input readOnly value={inviteUrl} className="input text-xs" />
            <button onClick={copyInvite} className="btn btn-outline">
              {copied ? (
                <IconCheck className="animate-pop size-[1.1em]" />
              ) : (
                <IconCopy className="size-[1.1em]" />
              )}
              {copied ? t.linkCopied : t.copyLink}
            </button>
            <button onClick={shareInvite} className="btn btn-outline">
              <IconShare className="size-[1.1em]" />
              {t.shareLink}
            </button>
          </div>
        </section>

        <section>
          <Label>{t.members}</Label>
          <div className="card row-divider overflow-hidden">
            {snapshot.members.map((member) => (
              <div key={member.id} className="flex items-center gap-1 px-4 py-2">
                <span className="min-w-0 flex-1 truncate font-medium">{member.name}</span>
                <button
                  onClick={() => renameMember(member.id, member.name)}
                  className="btn btn-ghost h-9 text-xs"
                >
                  {t.renameMember}
                </button>
                {usedMemberIds.has(member.id) ? (
                  <span
                    className="grid size-9 place-items-center text-[var(--line-strong)]"
                    title={t.memberInUse}
                    aria-label={t.removeMember}
                  >
                    <IconTrash className="size-4" />
                  </span>
                ) : (
                  <button
                    onClick={() => removeMember(member.id)}
                    aria-label={t.removeMember}
                    className="btn-icon size-9 hover:bg-rose-500/10 hover:text-rose-600"
                  >
                    <IconTrash className="size-4" />
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
              className="input"
            />
            <button
              onClick={() => void addMember()}
              className="btn btn-outline"
            >
              <IconPlus className="size-[1.1em]" />
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
                className={`btn ${locale === l ? "btn-primary" : "btn-neutral"}`}
              >
                {LOCALE_LABELS[l]}
              </button>
            ))}
          </div>
        </section>

        <section>
          <a
            href={`/g/${group.slug}/export.csv`}
            className="btn btn-neutral w-full"
          >
            <IconDownload className="size-[1.1em]" />
            {t.exportCsv}
          </a>
        </section>

        <section className="border-t border-[var(--line)] pt-4">
          <button onClick={() => void deleteGroup()} className="btn btn-danger -ml-3">
            <IconTrash className="size-[1.05em]" />
            {t.deleteGroup}
          </button>
        </section>
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
