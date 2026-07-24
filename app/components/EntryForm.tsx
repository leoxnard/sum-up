import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { useT } from "../root";
import { CURRENCIES } from "../lib/currencies";
import { CATEGORIES } from "../lib/categories";
import { IconCamera, IconTrash } from "./icons";
import { categoryLabel } from "../lib/i18n";
import { formatCents, parseAmountToCents, toBaseCents } from "../lib/money";
import { computeShares, type SplitInput } from "../lib/split";
import { submitOp } from "../lib/client/outbox";
import type { CategoryKey, Entry, EntryKind, GroupSnapshot, SplitMode, SyncOp } from "../lib/types";

interface Props {
  snapshot: GroupSnapshot;
  kind: EntryKind;
  me: string | null;
  /** present when editing */
  entry?: Entry;
}

function parseNumber(raw: string): number | null {
  const s = raw.trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const today = () => new Date().toISOString().slice(0, 10);

export function EntryForm({ snapshot, kind, me, entry }: Props) {
  const { t, intl } = useT();
  const navigate = useNavigate();
  const group = snapshot.group;
  const members = snapshot.members;

  const [title, setTitle] = useState(entry?.title ?? "");
  const [amountRaw, setAmountRaw] = useState(
    entry ? (entry.amountCents / 100).toFixed(2) : "",
  );
  const [currency, setCurrency] = useState(entry?.currency ?? group.baseCurrency);
  const [rateRaw, setRateRaw] = useState(entry ? String(entry.exchangeRate) : "1");
  const [rateAuto, setRateAuto] = useState(!entry);
  const [rateFailed, setRateFailed] = useState(false);
  const [date, setDate] = useState(entry?.expenseDate ?? today());
  const [note, setNote] = useState(entry?.note ?? "");
  const [payerId, setPayerId] = useState(
    entry?.payerId ?? (me && members.some((m) => m.id === me) ? me : (members[0]?.id ?? "")),
  );
  const [recipientId, setRecipientId] = useState(
    entry?.recipientId ?? (members.find((m) => m.id !== payerId)?.id ?? ""),
  );
  const [category, setCategory] = useState<CategoryKey | "auto">(
    entry?.categorySource === "manual" && entry.category ? entry.category : "auto",
  );
  const [mode, setMode] = useState<SplitMode>(entry?.splitMode ?? "equal");
  const [rows, setRows] = useState<Map<string, { included: boolean; raw: string }>>(() => {
    const map = new Map<string, { included: boolean; raw: string }>();
    for (const member of members) {
      const share = entry?.shares.find((s) => s.memberId === member.id);
      map.set(member.id, {
        included: entry ? !!share : true,
        raw:
          share?.inputValue != null
            ? entry!.splitMode === "exact"
              ? (share.inputValue / 100).toFixed(2)
              : String(share.inputValue)
            : "",
      });
    }
    return map;
  });
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [photoRemoved, setPhotoRemoved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const amountCents = parseAmountToCents(amountRaw);
  const rate = currency === group.baseCurrency ? 1 : parseNumber(rateRaw);
  const isForeign = currency !== group.baseCurrency;

  // Prefill the exchange rate from ECB dailies whenever the currency changes;
  // any manual edit turns auto mode off and the typed rate wins.
  useEffect(() => {
    if (!isForeign) return;
    if (!rateAuto) return;
    let cancelled = false;
    setRateFailed(false);
    fetch(`/api/rates?from=${currency}&to=${group.baseCurrency}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { rate: number }) => {
        if (!cancelled) setRateRaw(String(data.rate));
      })
      .catch(() => {
        if (!cancelled) {
          setRateFailed(true);
          setRateRaw("");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [currency, group.baseCurrency, isForeign, rateAuto]);

  /**
   * In "amounts" mode the last participant's field carries the remainder, so
   * entering n-1 amounts is enough. It fills in only once every *other*
   * participant has a number — so with three people it appears while the second
   * one is being typed, not the first — and it stays a plain editable input:
   * typing in it wins until one of the other values changes again.
   */
  function rebalance(
    next: Map<string, { included: boolean; raw: string }>,
    totalCents: number | null,
    splitMode: SplitMode,
    skipMemberId?: string,
  ) {
    if (splitMode !== "exact" || totalCents == null) return next;
    const target = [...members].reverse().find((m) => next.get(m.id)?.included);
    if (!target || target.id === skipMemberId) return next;

    let others = 0;
    let allOthersFilled = true;
    for (const member of members) {
      if (member.id === target.id) continue;
      const row = next.get(member.id);
      if (!row?.included) continue;
      if (row.raw.trim() === "") allOthersFilled = false;
      others += parseAmountToCents(row.raw) ?? 0;
    }

    const row = next.get(target.id)!;
    // Still a gap somewhere above — leave the remainder blank rather than
    // showing a number that is about to change again.
    const raw = allOthersFilled ? ((totalCents - others) / 100).toFixed(2) : "";
    if (raw === row.raw) return next;
    return new Map(next).set(target.id, { ...row, raw });
  }

  const splitInputs: SplitInput[] = useMemo(
    () =>
      members.map((member) => {
        const row = rows.get(member.id) ?? { included: true, raw: "" };
        let value: number | null = null;
        if (mode === "exact") value = parseAmountToCents(row.raw);
        else if (mode === "percent" || mode === "shares") value = parseNumber(row.raw);
        if (mode === "shares" && row.included && row.raw === "") value = 1;
        return { memberId: member.id, value, included: row.included };
      }),
    [members, rows, mode],
  );

  const split = useMemo(
    () => (amountCents ? computeShares(mode, amountCents, splitInputs) : null),
    [mode, amountCents, splitInputs],
  );

  const remaining = useMemo(() => {
    if (!amountCents) return null;
    if (mode === "exact") {
      const sum = splitInputs
        .filter((i) => i.included)
        .reduce((a, i) => a + (i.value ?? 0), 0);
      return formatCents(amountCents - sum, currency, intl);
    }
    if (mode === "percent") {
      const sum = splitInputs
        .filter((i) => i.included)
        .reduce((a, i) => a + (i.value ?? 0), 0);
      return `${(100 - sum).toLocaleString(intl)} %`;
    }
    return null;
  }, [mode, splitInputs, amountCents, currency, intl]);

  async function onPickPhoto(file: File) {
    const dataUrl = await resizeImage(file, 1600, 0.8);
    setPhotoDataUrl(dataUrl);
    setPhotoRemoved(false);
  }

  function validate(): string | null {
    if (kind === "expense" && !title.trim()) return t.errNoTitle;
    if (!amountCents || amountCents <= 0) return t.errNoAmount;
    if (isForeign && (!rate || rate <= 0)) return t.errNoRate;
    if (kind === "payment") {
      if (!recipientId || recipientId === payerId) return t.errSameMember;
      return null;
    }
    if (!split || !split.ok) {
      switch (split?.error) {
        case "exact_sum_mismatch": return t.errExactSum;
        case "percent_sum_mismatch": return t.errPercentSum;
        case "no_participants": return t.errNoParticipants;
        default: return t.errInvalidSplit;
      }
    }
    return null;
  }

  async function onSave() {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    const now = Date.now();
    const manual = category !== "auto";
    const op: SyncOp = {
      op: "upsert_entry",
      slug: group.slug,
      clientUpdatedAt: now,
      groupId: group.id,
      entry: {
        id: entry?.id ?? crypto.randomUUID(),
        kind,
        title: kind === "expense" ? title.trim() : null,
        note: note.trim() || null,
        category: manual ? (category as CategoryKey) : null,
        categorySource: manual ? "manual" : null,
        payerId,
        recipientId: kind === "payment" ? recipientId : null,
        amountCents: amountCents!,
        currency,
        exchangeRate: rate!,
        splitMode: mode,
        expenseDate: date,
        shares:
          kind === "expense" && split?.ok
            ? split.shares
            : [],
      },
      photoDataUrl: photoDataUrl,
      photoChanged: photoDataUrl !== null || photoRemoved,
    };
    await submitOp(op);
    navigate(`/g/${group.slug}`);
  }

  async function onDelete() {
    if (!entry) return;
    if (!confirm(t.deleteEntryConfirm)) return;
    await submitOp({
      op: "delete_entry",
      slug: group.slug,
      clientUpdatedAt: Date.now(),
      groupId: group.id,
      entryId: entry.id,
    });
    navigate(`/g/${group.slug}`);
  }

  const heading =
    kind === "payment"
      ? entry ? t.editPayment : t.newPayment
      : entry ? t.editExpense : t.newExpense;

  const existingPhotoUrl =
    entry?.photoId && !photoRemoved && !photoDataUrl
      ? `/g/${group.slug}/photo/${entry.photoId}`
      : null;

  return (
    <main className="animate-rise px-4 pb-16 pt-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">{heading}</h1>
        <button onClick={() => navigate(-1)} className="btn btn-ghost -mr-3">
          {t.cancel}
        </button>
      </header>

      <div className="mt-5 flex flex-col gap-4">
        {kind === "expense" && (
          <Field label={t.title}>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t.titlePlaceholder}
              className="input"
              autoFocus={!entry}
            />
          </Field>
        )}

        <div className="flex gap-3">
          <Field label={t.amount} className="flex-1">
            <input
              value={amountRaw}
              onChange={(e) => {
                setAmountRaw(e.target.value);
                setRows((current) =>
                  rebalance(current, parseAmountToCents(e.target.value), mode),
                );
              }}
              inputMode="decimal"
              placeholder="0.00"
              className="input text-lg font-semibold tabular-nums"
            />
          </Field>
          <Field label={t.currency}>
            <select
              value={currency}
              onChange={(e) => {
                setCurrency(e.target.value);
                setRateAuto(true);
              }}
              className="input"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>
        </div>

        {isForeign && (
          <Field label={`${t.exchangeRate} — ${t.exchangeRateHint(currency, group.baseCurrency)}`}>
            <input
              value={rateRaw}
              onChange={(e) => {
                setRateRaw(e.target.value);
                setRateAuto(false);
              }}
              inputMode="decimal"
              className="input tabular-nums"
            />
            {rateFailed && rateAuto !== false && (
              <p className="mt-1 text-xs text-amber-600">{t.rateUnavailable}</p>
            )}
            {amountCents != null && rate != null && rate > 0 && (
              <p className="mt-1 text-xs text-neutral-500">
                {t.converted}:{" "}
                <span className="font-medium tabular-nums">
                  {formatCents(toBaseCents(amountCents, rate), group.baseCurrency, intl)}
                </span>
              </p>
            )}
          </Field>
        )}

        <Field label={kind === "payment" ? t.payer : t.payer}>
          <MemberSelect members={members} value={payerId} onChange={setPayerId} />
        </Field>

        {kind === "payment" && (
          <Field label={t.recipient}>
            <MemberSelect members={members} value={recipientId} onChange={setRecipientId} />
          </Field>
        )}

        {kind === "expense" && (
          <Field label={t.splitBetween}>
            <div className="segment mb-2 grid-cols-4">
              {(["equal", "exact", "percent", "shares"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => {
                    setMode(m);
                    setRows((current) => rebalance(current, amountCents, m));
                  }}
                  className="segment-item"
                >
                  {m === "equal" ? t.splitEqual : m === "exact" ? t.splitExact : m === "percent" ? t.splitPercent : t.splitShares}
                </button>
              ))}
            </div>
            <div className="card row-divider overflow-hidden">
              {members.map((member, index) => {
                const row = rows.get(member.id) ?? { included: true, raw: "" };
                // Shown in a slot that is always reserved, so the row doesn't
                // reflow the moment the split starts adding up. While the sum
                // is still off, exact mode can at least echo what was typed.
                const shareCents = split?.ok
                  ? split.shares.find((s) => s.memberId === member.id)?.shareCents
                  : mode === "exact"
                    ? parseAmountToCents(row.raw)
                    : null;
                return (
                  <label
                    key={member.id}
                    className="flex cursor-pointer items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-[var(--surface-sunken)]"
                  >
                    <input
                      type="checkbox"
                      checked={row.included}
                      onChange={(e) =>
                        setRows(
                          rebalance(
                            new Map(rows).set(member.id, {
                              ...row,
                              included: e.target.checked,
                            }),
                            amountCents,
                            mode,
                          ),
                        )
                      }
                      className="checkbox"
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">{member.name}</span>
                    {mode !== "equal" && row.included && (
                      <input
                        value={row.raw}
                        onChange={(e) =>
                          setRows(
                            rebalance(
                              new Map(rows).set(member.id, { ...row, raw: e.target.value }),
                              amountCents,
                              mode,
                              member.id,
                            ),
                          )
                        }
                        inputMode="decimal"
                        placeholder={mode === "shares" ? "1" : mode === "percent" ? "0" : "0.00"}
                        className="input h-9 w-20 bg-[var(--surface-sunken)] px-2.5 text-right text-sm tabular-nums"
                      />
                    )}
                    {mode === "percent" && row.included && (
                      <span className="text-xs text-[var(--text-muted)]">%</span>
                    )}
                    {row.included && (
                      <span className="w-20 shrink-0 text-right text-xs tabular-nums text-[var(--text-muted)]">
                        {shareCents != null ? formatCents(shareCents, currency, intl) : ""}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
            {remaining !== null && (
              <p className="mt-1 text-right text-xs text-neutral-500">
                {t.splitRestHint}: <span className="tabular-nums">{remaining}</span>
              </p>
            )}
          </Field>
        )}

        <div className="flex gap-3">
          <Field label={t.date} className="flex-1">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="input"
            />
          </Field>
          {kind === "expense" && (
            <Field label={t.category} className="flex-1">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as CategoryKey | "auto")}
                className="input"
              >
                <option value="auto">{t.categoryAuto}</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {categoryLabel(t, c)}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>

        <Field label={t.note}>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t.notePlaceholder}
            className="input"
          />
        </Field>

        {kind === "expense" && (
          <Field label={t.receipt}>
            {(photoDataUrl || existingPhotoUrl) && (
              <img
                src={photoDataUrl ?? existingPhotoUrl ?? undefined}
                alt=""
                className="animate-pop mb-2 max-h-56 rounded-[var(--radius-card)] border border-[var(--line)] object-contain"
              />
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="btn btn-neutral"
              >
                <IconCamera className="size-[1.15em]" />
                {t.addPhoto}
              </button>
              {(photoDataUrl || existingPhotoUrl) && (
                <button
                  type="button"
                  onClick={() => {
                    setPhotoDataUrl(null);
                    setPhotoRemoved(true);
                  }}
                  className="btn btn-danger"
                >
                  {t.removePhoto}
                </button>
              )}
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onPickPhoto(file);
              }}
            />
          </Field>
        )}

        {error && (
          <p className="animate-pop rounded-xl bg-rose-500/10 px-3.5 py-2.5 text-sm font-medium text-rose-600 dark:text-rose-400">
            {error}
          </p>
        )}

        <button onClick={() => void onSave()} className="btn btn-primary btn-lg mt-2">
          {t.save}
        </button>
        {entry && (
          <button onClick={() => void onDelete()} className="btn btn-danger">
            <IconTrash className="size-[1.05em]" />
            {t.delete}
          </button>
        )}
      </div>
    </main>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-sm font-medium text-[var(--text-muted)]">
        {label}
      </label>
      {children}
    </div>
  );
}

function MemberSelect({
  members,
  value,
  onChange,
}: {
  members: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="input">
      {members.map((m) => (
        <option key={m.id} value={m.id}>{m.name}</option>
      ))}
    </select>
  );
}

/** Downscale + JPEG-compress a photo client-side so uploads stay small. */
async function resizeImage(file: File, maxSize: number, quality: number): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}
