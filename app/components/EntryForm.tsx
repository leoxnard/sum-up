import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

import { useT } from "../root";
import { CURRENCIES } from "../lib/currencies";
import { CATEGORIES } from "../lib/categories";
import { resizeImage } from "../lib/client/image";
import { readClipboard } from "../lib/client/clipboard";
import { findDuplicates } from "../lib/duplicates";
import { DuplicateNotice } from "./DuplicateWarning";
import { PushPanel, Sheet, SheetHead, useDismiss } from "./overlays";
import { IconBackspace, IconCamera, IconClipboard, IconSparkles, IconTrash } from "./icons";
import { categoryLabel } from "../lib/i18n";
import { cleanAmountInput, formatCents, parseAmountToCents, toBaseCents } from "../lib/money";
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

function EntryFields({ snapshot, kind, me, entry }: Props) {
  const { t, intl } = useT();
  const dismiss = useDismiss();
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

  // Expenses that look like the one being typed. Recomputed as the fields
  // change, so the hint shows up the moment the amount makes it identifiable —
  // it never blocks saving, it just makes the double booking visible first.
  const duplicates = useMemo(() => {
    if (kind !== "expense" || !amountCents || amountCents <= 0 || !rate || rate <= 0) return [];
    return findDuplicates(
      {
        id: entry?.id ?? null,
        title,
        amountBaseCents: toBaseCents(amountCents, rate),
        date,
      },
      snapshot.entries,
    );
  }, [kind, amountCents, rate, title, date, entry?.id, snapshot.entries]);

  const memberName = useMemo(
    () => new Map(members.map((m) => [m.id, m.name])),
    [members],
  );

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
    dismiss();
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
    dismiss();
  }


  const heading =
    kind === "payment"
      ? entry ? t.editPayment : t.newPayment
      : entry ? t.editExpense : t.newExpense;

  const existingPhotoUrl =
    entry?.photoId && !photoRemoved && !photoDataUrl
      ? `/g/${group.slug}/photo/${entry.photoId}`
      : null;

  const fields = (
    <>
      {kind === "expense" && !entry && (
        // Typing it and capturing it are two ways into the same job, so they
        // sit on one switch rather than behind separate buttons. The AI half is
        // its own route — the import screen explains itself when the key is
        // missing, exactly as it does when reached any other way.
        <div className="segment mb-4 grid-cols-2">
          <span aria-current="page" className="segment-item text-center">
            {t.modeManual}
          </span>
          <Link to={`/g/${group.slug}/import`} className="segment-item text-center">
            {t.modeAI}
          </Link>
        </div>
      )}

      <AmountPad
        raw={amountRaw}
        currency={currency}
        onChange={(next) => {
          setAmountRaw(next);
          setRows((current) => rebalance(current, parseAmountToCents(next), mode));
        }}
        caption={
          kind === "expense" && split?.ok && amountCents
            ? `${split.shares.length} × ${formatCents(
                Math.round(amountCents / split.shares.length),
                currency,
                intl,
              )}`
            : null
        }
      />

      <div className="mt-5 flex flex-col gap-4">
        {kind === "expense" && (
          <Field label={t.title}>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t.titlePlaceholder}
              className="input"
            />
          </Field>
        )}

        {/* 31 ECB currencies is a chip wall — this one stays a select. */}
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

        {isForeign && (
          <Field label={`${t.exchangeRate} — ${t.exchangeRateHint(currency, group.baseCurrency)}`}>
            <input
              value={rateRaw}
              onChange={(e) => {
                setRateRaw(e.target.value);
                setRateAuto(false);
              }}
              inputMode="decimal"
              className="input num font-normal"
            />
            {rateFailed && rateAuto !== false && (
              <p className="mt-1.5 text-xs text-[var(--warn-text)]">{t.rateUnavailable}</p>
            )}
            {amountCents != null && rate != null && rate > 0 && (
              <p className="mt-1.5 text-xs text-[var(--text-2)]">
                {t.converted}:{" "}
                <span className="num text-xs">
                  {formatCents(toBaseCents(amountCents, rate), group.baseCurrency, intl)}
                </span>
              </p>
            )}
          </Field>
        )}

        <DuplicateNotice matches={duplicates} memberName={memberName} />

        <Field label={t.payer}>
          <ChipGroup
            options={members.map((m) => ({ id: m.id, label: m.name }))}
            value={payerId}
            onChange={setPayerId}
          />
        </Field>

        {kind === "payment" && (
          <Field label={t.recipient}>
            <ChipGroup
              options={members.map((m) => ({ id: m.id, label: m.name }))}
              value={recipientId}
              onChange={setRecipientId}
            />
          </Field>
        )}

        {kind === "expense" && (
          <Field label={t.splitBetween}>
            <div className="segment mb-2.5 grid-cols-4">
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
            <div className="glass glass-list">
              {members.map((member) => {
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
                  <label key={member.id} className="glass-row cursor-pointer">
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
                    <span className="min-w-0 flex-1 truncate font-semibold">{member.name}</span>
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
                        onPaste={(e) => {
                          const text = e.clipboardData.getData("text");
                          if (!text) return;
                          e.preventDefault();
                          setRows(
                            rebalance(
                              new Map(rows).set(member.id, {
                                ...row,
                                raw: cleanAmountInput(text),
                              }),
                              amountCents,
                              mode,
                              member.id,
                            ),
                          );
                        }}
                        inputMode="decimal"
                        placeholder={mode === "shares" ? "1" : mode === "percent" ? "0" : "0.00"}
                        className="input num h-9 w-20 px-2.5 text-right text-sm font-normal"
                      />
                    )}
                    {mode === "percent" && row.included && (
                      <span className="text-xs text-[var(--text-2)]">%</span>
                    )}
                    {row.included && (
                      <span className="num w-20 shrink-0 text-right text-xs font-medium text-[var(--text-2)]">
                        {shareCents != null ? formatCents(shareCents, currency, intl) : ""}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
            {remaining !== null && (
              <p className="mt-1.5 text-right text-xs text-[var(--text-2)]">
                {t.splitRestHint}: <span className="num text-xs">{remaining}</span>
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
                className="animate-pop mb-2 max-h-56 rounded-[var(--radius-card)] border border-[var(--glass-border)] object-contain"
              />
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="btn btn-neutral"
              >
                <IconCamera className="size-[1.15em]" />
                {t.addPhoto}
              </button>
              {!entry && (
                <Link to={`/g/${group.slug}/import`} className="btn btn-neutral">
                  <IconSparkles className="size-[1.15em]" />
                  {t.importTitle}
                </Link>
              )}
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
      </div>
    </>
  );

  // Editing arrives as a pushed panel, so its actions sit at the foot of the
  // page; a new entry arrives as a sheet, where Save belongs in the header next
  // to Cancel and the body scrolls underneath.
  if (entry) {
    return (
      <>
        {fields}
        <button onClick={() => void onSave()} className="btn btn-primary btn-lg mt-5 w-full">
          {t.save}
        </button>
        <button onClick={() => void onDelete()} className="btn btn-danger mt-2.5 w-full">
          <IconTrash className="size-[1.05em]" />
          {t.delete}
        </button>
      </>
    );
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
        <h2 className="min-w-0 flex-1 truncate text-center text-base font-bold">{heading}</h2>
        <button
          onClick={() => void onSave()}
          className="btn btn-primary h-9 shrink-0 rounded-2xl px-4 text-sm"
        >
          {t.save}
        </button>
      </header>
      <div className="sheet-body pt-4">{fields}</div>
    </>
  );
}

export function EntryForm(props: Props) {
  const { t } = useT();
  const backTo = `/g/${props.snapshot.group.slug}`;
  const heading =
    props.kind === "payment"
      ? props.entry ? t.editPayment : t.newPayment
      : props.entry ? t.editExpense : t.newExpense;

  if (props.entry) {
    return (
      <PushPanel backTo={backTo} title={heading}>
        <EntryFields {...props} />
      </PushPanel>
    );
  }
  return (
    <Sheet backTo={backTo} label={heading}>
      <EntryFields {...props} />
    </Sheet>
  );
}

/**
 * The amount, at the size the design gives it, driven by an on-screen pad.
 *
 * The display is still a real input with `inputMode="none"`: that suppresses
 * the system keyboard (the pad replaces it) while keeping the caret, physical
 * keyboards, screen readers and — the reason this matters — iOS's long-press
 * Paste callout, which a plain div would swallow. The Paste button next to it
 * covers the browsers that hide the callout.
 */
function AmountPad({
  raw,
  currency,
  caption,
  onChange,
}: {
  raw: string;
  currency: string;
  caption: string | null;
  onChange: (next: string) => void;
}) {
  const { t } = useT();
  const [pasteError, setPasteError] = useState<string | null>(null);

  /** Append one character, keeping the value a well-formed decimal. */
  function press(key: string) {
    if (key === ".") {
      if (raw.includes(".")) return;
      onChange((raw || "0") + ".");
      return;
    }
    const [, decimals] = raw.split(".");
    if (decimals !== undefined && decimals.length >= 2) return;
    if (raw === "0") {
      onChange(key);
      return;
    }
    onChange(raw + key);
  }

  async function paste() {
    setPasteError(null);
    try {
      const item = await readClipboard();
      if (item.kind !== "text") {
        setPasteError(t.pasteEmpty);
        return;
      }
      const cleaned = cleanAmountInput(item.text);
      if (parseAmountToCents(cleaned) == null) {
        setPasteError(t.pasteEmpty);
        return;
      }
      onChange(cleaned);
    } catch {
      setPasteError(t.pasteDenied);
    }
  }

  return (
    <section>
      <div className="flex items-baseline justify-center gap-2">
        <input
          value={raw}
          onChange={(e) => onChange(cleanAmountInput(e.target.value))}
          onPaste={(e) => {
            // "12,50 €" out of a banking app or a chat has to land as an
            // amount, not as text the field then refuses to parse.
            const text = e.clipboardData.getData("text");
            if (!text) return;
            e.preventDefault();
            onChange(cleanAmountInput(text));
          }}
          inputMode="none"
          placeholder="0.00"
          aria-label={t.amount}
          className="num w-full border-0 bg-transparent p-0 text-center text-[3.125rem] leading-none tracking-[-0.03em] outline-none placeholder:text-[var(--text-3)]"
        />
      </div>
      <p className="mt-1.5 text-center text-[0.78125rem] text-[var(--text-2)]">
        {caption ?? currency}
      </p>

      <div className="mt-4 grid grid-cols-3 gap-2.5">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((key) => (
          <button key={key} type="button" onClick={() => press(key)} className="key">
            {key}
          </button>
        ))}
        <button type="button" onClick={() => press(".")} className="key">
          .
        </button>
        <button type="button" onClick={() => press("0")} className="key">
          0
        </button>
        <button
          type="button"
          onClick={() => onChange(raw.slice(0, -1))}
          aria-label={t.backspace}
          className="key"
        >
          <IconBackspace className="size-[1.375rem]" />
        </button>
      </div>

      <button type="button" onClick={() => void paste()} className="btn btn-ghost mt-2.5 w-full">
        <IconClipboard className="size-[1.05em]" />
        {t.pasteClipboard}
      </button>
      {pasteError && (
        <p className="mt-1 text-center text-xs text-[var(--warn-text)]">{pasteError}</p>
      )}
    </section>
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
      <label className="section-label mb-2 block">{label}</label>
      {children}
    </div>
  );
}

/** A row of tap targets where a `<select>` used to be — one tap, no dropdown. */
function ChipGroup({
  options,
  value,
  onChange,
}: {
  options: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={option.id === value}
          onClick={() => onChange(option.id)}
          className="chip"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
