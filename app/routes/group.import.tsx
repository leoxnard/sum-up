import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useFetcher, useNavigate } from "react-router";

import type { Route } from "./+types/group.import";
import { useGroup } from "./group";
import { useT } from "../root";
import { sql } from "../lib/server/db.server";
import { extractExpensesFromImage } from "../lib/server/vision.server";
import { CATEGORIES } from "../lib/categories";
import { CURRENCIES } from "../lib/currencies";
import { formatCents, parseAmountToCents, toBaseCents } from "../lib/money";
import { computeShares } from "../lib/split";
import { categoryLabel } from "../lib/i18n";
import { resizeImage } from "../lib/client/image";
import { submitOp } from "../lib/client/outbox";
import {
  CategoryIcon,
  IconArrowLeft,
  IconCalendar,
  IconChevronDown,
  IconSparkles,
  IconUser,
  IconUsers,
} from "../components/icons";
import type { CategoryKey, SyncOp } from "../lib/types";

/** Widens the group shell — the review needs two columns on a big screen. */
export const handle = { wide: true };

const today = () => new Date().toISOString().slice(0, 10);

export async function action({ request, params }: Route.ActionArgs) {
  let dataUrl = "";
  try {
    const body = (await request.json()) as { dataUrl?: unknown };
    if (typeof body.dataUrl === "string") dataUrl = body.dataUrl;
  } catch {
    return { ok: false as const, error: "unreadable" as const };
  }
  // Bounded well below the serverless body limit; the client resizes first.
  if (!dataUrl || dataUrl.length > 6_000_000) {
    return { ok: false as const, error: "too_large" as const };
  }

  // The slug is the credential, exactly like everywhere else — and it's also
  // where the base currency comes from, so the client can't influence it.
  const rows = await sql<{ base_currency: string }[]>`
    select base_currency from groups where slug = ${params.slug} and deleted_at is null
  `;
  if (rows.length === 0) throw new Response("Not found", { status: 404 });

  const result = await extractExpensesFromImage(dataUrl, rows[0].base_currency, today());
  if (!result.ok) return { ok: false as const, error: result.error };
  return { ok: true as const, expenses: result.expenses };
}

interface Row {
  id: string;
  selected: boolean;
  title: string;
  amountRaw: string;
  currency: string;
  date: string;
  category: CategoryKey;
  /** the user picked the category themselves — teaches the group's override table */
  categoryTouched: boolean;
  payerId: string;
  participants: string[];
  expanded: boolean;
}

export default function ImportFromImage() {
  const { snapshot, me, offline } = useGroup();
  const { t, intl } = useT();
  const navigate = useNavigate();
  const fetcher = useFetcher<typeof action>();
  const group = snapshot.group;
  const members = snapshot.members;
  const base = group.baseCurrency;

  const defaultPayer = me && members.some((m) => m.id === me) ? me : (members[0]?.id ?? "");
  const allMemberIds = useMemo(() => members.map((m) => m.id), [members]);

  const [image, setImage] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [rates, setRates] = useState<Record<string, { raw: string; failed: boolean }>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const analyzing = fetcher.state !== "idle";

  // Turn a finished extraction into editable rows, applying the defaults:
  // whoever is importing paid, split equally between everyone.
  useEffect(() => {
    const data = fetcher.data;
    if (!data) return;
    if (!data.ok) {
      setError(
        data.error === "no_key"
          ? t.importUnavailable
          : data.error === "too_large"
            ? t.importTooLarge
            : t.importFailed,
      );
      setRows(null);
      return;
    }
    setError(null);
    setRows(
      data.expenses.map((expense) => ({
        id: crypto.randomUUID(),
        selected: true,
        title: expense.title,
        amountRaw: (expense.amountCents / 100).toFixed(2),
        currency: expense.currency,
        date: expense.date ?? today(),
        category: expense.category ?? "other",
        categoryTouched: false,
        payerId: defaultPayer,
        participants: allMemberIds,
        expanded: false,
      })),
    );
    // Defaults are a snapshot of the moment the extraction lands; re-running on
    // every member edit would throw away the user's per-row corrections.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  // Prefill an exchange rate per foreign currency that actually shows up.
  const foreignCurrencies = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows ?? []) if (row.selected && row.currency !== base) set.add(row.currency);
    return [...set];
  }, [rows, base]);

  useEffect(() => {
    for (const currency of foreignCurrencies) {
      if (rates[currency]) continue;
      setRates((current) => ({ ...current, [currency]: { raw: "", failed: false } }));
      fetch(`/api/rates?from=${currency}&to=${base}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("rate"))))
        .then((data: { rate: number }) =>
          setRates((current) => ({ ...current, [currency]: { raw: String(data.rate), failed: false } })),
        )
        .catch(() =>
          setRates((current) => ({ ...current, [currency]: { raw: "", failed: true } })),
        );
    }
  }, [foreignCurrencies, rates, base]);

  async function onPickFile(file: File) {
    setError(null);
    setRows(null);
    if (offline || !navigator.onLine) {
      setError(t.importOffline);
      return;
    }
    let dataUrl: string;
    try {
      dataUrl = await resizeImage(file, 1500, 0.8);
    } catch {
      // Formats the browser can't decode (some HEIC/RAW pickers) land here.
      setError(t.importFailed);
      return;
    }
    setImage(dataUrl);
    fetcher.submit({ dataUrl }, { method: "post", encType: "application/json" });
  }

  function patchRow(id: string, patch: Partial<Row>) {
    setRows((current) => current?.map((r) => (r.id === id ? { ...r, ...patch } : r)) ?? null);
  }

  const selected = (rows ?? []).filter((r) => r.selected);

  function rateFor(currency: string): number | null {
    if (currency === base) return 1;
    const raw = rates[currency]?.raw.trim().replace(",", ".");
    const value = raw ? Number(raw) : NaN;
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  async function onAdd() {
    if (selected.length === 0) {
      setError(t.errImportNoneSelected);
      return;
    }
    const ops: SyncOp[] = [];
    for (const row of selected) {
      const amountCents = parseAmountToCents(row.amountRaw);
      const rate = rateFor(row.currency);
      const split = amountCents
        ? computeShares(
            "equal",
            amountCents,
            members.map((m) => ({
              memberId: m.id,
              value: null,
              included: row.participants.includes(m.id),
            })),
          )
        : null;
      if (!amountCents || amountCents <= 0 || !rate || !split?.ok || !row.title.trim()) {
        setError(t.errImportRow(row.title.trim() || "?"));
        return;
      }
      ops.push({
        op: "upsert_entry",
        slug: group.slug,
        clientUpdatedAt: Date.now(),
        groupId: group.id,
        entry: {
          id: row.id,
          kind: "expense",
          title: row.title.trim(),
          note: null,
          category: row.category,
          // A reviewed vision guess is trustworthy enough to keep, but only a
          // deliberate pick teaches the group's learned categories.
          categorySource: row.categoryTouched ? "manual" : "llm",
          payerId: row.payerId,
          recipientId: null,
          amountCents,
          currency: row.currency,
          exchangeRate: rate,
          splitMode: "equal",
          expenseDate: row.date,
          shares: split.shares,
        },
        // A single-expense image is a receipt for that expense — keep it. For a
        // transaction list the same screenshot on every entry is just noise.
        photoDataUrl: selected.length === 1 ? image : null,
        photoChanged: selected.length === 1 && image !== null,
      });
    }
    setSaving(true);
    for (const op of ops) await submitOp(op);
    navigate(`/g/${group.slug}`);
  }

  return (
    <main className="px-4 pb-32 pt-6">
      <header className="animate-rise flex items-center gap-1">
        <Link to={`/g/${group.slug}`} aria-label={t.cancel} className="btn-icon -ml-2.5 shrink-0">
          <IconArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-xl font-bold tracking-tight">
          {t.importFromImage}
        </h1>
      </header>

      {rows === null ? (
        <PickScreen
          analyzing={analyzing}
          image={image}
          error={error}
          onPick={() => fileInput.current?.click()}
        />
      ) : (
        <div className="mt-5 gap-6 md:grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:items-start">
          <figure className="md:sticky md:top-6">
            <button
              type="button"
              onClick={() => setZoomed((z) => !z)}
              className="card block w-full overflow-hidden bg-[var(--surface-sunken)] p-0"
            >
              <img
                src={image ?? undefined}
                alt={t.importOriginal}
                className={`w-full object-contain transition-[max-height] duration-300 ${
                  zoomed ? "max-h-[none]" : "max-h-56 md:max-h-[70vh]"
                }`}
              />
            </button>
            <figcaption className="mt-1.5 flex items-center justify-between px-1 text-xs text-[var(--text-muted)]">
              <span>{t.importOriginal}</span>
              <button
                type="button"
                onClick={() => {
                  setRows(null);
                  setImage(null);
                  fileInput.current?.click();
                }}
                className="font-medium underline underline-offset-2"
              >
                {t.importRetry}
              </button>
            </figcaption>
          </figure>

          <section className="mt-5 md:mt-0">
            {rows.length === 0 ? (
              <p className="card px-4 py-8 text-center text-sm text-[var(--text-muted)]">
                {t.importNothingFound}
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="section-label">{t.importFound(rows.length)}</h2>
                  <button
                    type="button"
                    onClick={() => {
                      const target = selected.length < rows.length;
                      setRows(rows.map((r) => ({ ...r, selected: target })));
                    }}
                    className="text-xs font-semibold text-[var(--accent)]"
                  >
                    {selected.length < rows.length ? t.importSelectAll : t.importDeselectAll}
                  </button>
                </div>
                <p className="mt-1 text-xs text-[var(--text-muted)]">{t.importCheckHint}</p>

                {members.length > 1 && (
                  <label className="mt-3 flex items-center gap-2 rounded-[var(--radius-control)] bg-[var(--surface-sunken)] px-3 py-2 text-sm">
                    <IconUser className="size-4 shrink-0 text-[var(--text-muted)]" />
                    <span className="shrink-0 text-[var(--text-muted)]">{t.importPayerForAll}</span>
                    <select
                      value={rows.every((r) => r.payerId === rows[0].payerId) ? rows[0].payerId : ""}
                      onChange={(e) =>
                        setRows(rows.map((r) => ({ ...r, payerId: e.target.value })))
                      }
                      className="min-w-0 flex-1 bg-transparent font-medium outline-none"
                    >
                      <option value="" disabled>
                        —
                      </option>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <div className="stagger mt-3 flex flex-col gap-2">
                  {rows.map((row, index) => (
                    <ExpenseRow
                      key={row.id}
                      row={row}
                      index={index}
                      members={members}
                      base={base}
                      rate={rateFor(row.currency)}
                      onChange={(patch) => patchRow(row.id, patch)}
                    />
                  ))}
                </div>

                {foreignCurrencies.length > 0 && (
                  <div className="mt-4 flex flex-col gap-2">
                    {foreignCurrencies.map((currency) => (
                      <label
                        key={currency}
                        className="flex items-center gap-2 rounded-[var(--radius-control)] bg-[var(--surface-sunken)] px-3 py-2 text-sm"
                      >
                        <span className="shrink-0 text-[var(--text-muted)]">
                          {t.exchangeRateHint(currency, base)}
                        </span>
                        <input
                          value={rates[currency]?.raw ?? ""}
                          onChange={(e) =>
                            setRates((current) => ({
                              ...current,
                              [currency]: { raw: e.target.value, failed: false },
                            }))
                          }
                          inputMode="decimal"
                          placeholder="1.00"
                          className="min-w-0 flex-1 bg-transparent text-right font-medium tabular-nums outline-none"
                        />
                      </label>
                    ))}
                    {foreignCurrencies.some((c) => rates[c]?.failed) && (
                      <p className="text-xs text-amber-600">{t.rateUnavailable}</p>
                    )}
                  </div>
                )}

                {selected.length === 1 && image && (
                  <p className="mt-3 text-xs text-[var(--text-muted)]">{t.importPhotoAttached}</p>
                )}
              </>
            )}

            {error && (
              <p className="animate-pop mt-4 rounded-xl bg-rose-500/10 px-3.5 py-2.5 text-sm font-medium text-rose-600 dark:text-rose-400">
                {error}
              </p>
            )}
          </section>
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ""; // let the same file be picked again after a retry
          if (file) void onPickFile(file);
        }}
      />

      {rows !== null && rows.length > 0 && (
        <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-10">
          <div aria-hidden className="h-10 bg-gradient-to-t from-[var(--page)] to-transparent" />
          <div className="pointer-events-auto mx-auto flex max-w-lg items-center gap-3 bg-[var(--page)] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] lg:max-w-3xl">
            {/* The button already carries the count — on a phone the label would
                only squeeze the total out of it. */}
            <span className="hidden shrink-0 text-xs text-[var(--text-muted)] sm:block">
              {t.importSelected(selected.length, rows.length)}
            </span>
            <button
              onClick={() => void onAdd()}
              disabled={selected.length === 0 || saving}
              className="btn btn-primary btn-lg flex-1"
            >
              {t.importAddSelected(selected.length)}
              <span className="ml-1 text-sm font-normal opacity-80 tabular-nums">
                {selectedTotalLabel(selected, base, rateFor, intl)}
              </span>
            </button>
          </div>
        </nav>
      )}
    </main>
  );
}

/** Total of everything that is about to be booked, in the group's base currency. */
function selectedTotalLabel(
  selected: Row[],
  base: string,
  rateFor: (currency: string) => number | null,
  intl: string,
): string {
  let total = 0;
  for (const row of selected) {
    const cents = parseAmountToCents(row.amountRaw);
    const rate = rateFor(row.currency);
    if (cents == null || rate == null) return "";
    total += toBaseCents(cents, rate);
  }
  return total > 0 ? formatCents(total, base, intl) : "";
}

function PickScreen({
  analyzing,
  image,
  error,
  onPick,
}: {
  analyzing: boolean;
  image: string | null;
  error: string | null;
  onPick: () => void;
}) {
  const { t } = useT();
  return (
    <div className="animate-rise mx-auto mt-6 max-w-lg text-center">
      {analyzing && image ? (
        <>
          <div className="card relative mx-auto overflow-hidden">
            <img src={image} alt="" className="max-h-72 w-full object-contain opacity-60" />
            {/* A sweep across the image while the model reads it. */}
            <span
              aria-hidden
              className="animate-scan pointer-events-none absolute inset-x-0 h-24 bg-gradient-to-b from-transparent via-[var(--accent)]/25 to-transparent"
            />
          </div>
          <p className="mt-5 flex items-center justify-center gap-2 font-medium">
            <IconSparkles className="size-5 animate-pulse text-[var(--accent)]" />
            {t.importAnalyzing}
          </p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{t.importAnalyzingHint}</p>
        </>
      ) : (
        <>
          <span className="glyph mx-auto mb-4 flex size-14 items-center justify-center">
            <IconSparkles className="size-7 text-[var(--accent)]" />
          </span>
          <p className="text-sm text-[var(--text-muted)]">{t.importIntro}</p>
          {error && (
            <p className="animate-pop mt-4 rounded-xl bg-rose-500/10 px-3.5 py-2.5 text-sm font-medium text-rose-600 dark:text-rose-400">
              {error}
            </p>
          )}
          <button onClick={onPick} className="btn btn-primary btn-lg mt-6 w-full">
            {t.importPickImage}
          </button>
        </>
      )}
    </div>
  );
}

function ExpenseRow({
  row,
  index,
  members,
  base,
  rate,
  onChange,
}: {
  row: Row;
  index: number;
  members: { id: string; name: string }[];
  base: string;
  rate: number | null;
  onChange: (patch: Partial<Row>) => void;
}) {
  const { t, intl } = useT();
  const dateFormat = new Intl.DateTimeFormat(intl, { day: "numeric", month: "short" });
  const amountCents = parseAmountToCents(row.amountRaw);
  const payerName = members.find((m) => m.id === row.payerId)?.name ?? "—";
  const everyone = row.participants.length === members.length;
  const participantLabel = everyone
    ? t.importEveryone
    : row.participants.length === 1
      ? (members.find((m) => m.id === row.participants[0])?.name ?? "—")
      : `${row.participants.length}/${members.length}`;

  return (
    <div
      style={{ "--i": Math.min(index, 12) } as React.CSSProperties}
      className={`card px-2.5 py-2 transition-opacity ${row.selected ? "" : "opacity-45"}`}
    >
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={row.selected}
          onChange={(e) => onChange({ selected: e.target.checked })}
          aria-label={row.title}
          className="checkbox shrink-0"
        />
        <PillControl
          label=""
          icon={<CategoryIcon category={row.category} className="size-[1.05rem]" />}
          compact
        >
          <select
            value={row.category}
            onChange={(e) =>
              onChange({ category: e.target.value as CategoryKey, categoryTouched: true })
            }
            aria-label={t.category}
            className="absolute inset-0 cursor-pointer opacity-0"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {categoryLabel(t, c)}
              </option>
            ))}
          </select>
        </PillControl>
        <input
          value={row.title}
          onChange={(e) => onChange({ title: e.target.value })}
          aria-label={t.title}
          className="min-w-0 flex-1 bg-transparent font-medium outline-none focus:underline focus:decoration-[var(--line-strong)] focus:underline-offset-4"
        />
        <input
          value={row.amountRaw}
          onChange={(e) => onChange({ amountRaw: e.target.value })}
          inputMode="decimal"
          aria-label={t.amount}
          className="w-[4.5rem] shrink-0 bg-transparent text-right font-semibold tabular-nums outline-none focus:underline focus:decoration-[var(--line-strong)] focus:underline-offset-4"
        />
        <select
          value={row.currency}
          onChange={(e) => onChange({ currency: e.target.value })}
          aria-label={t.currency}
          className="shrink-0 cursor-pointer bg-transparent text-xs font-medium text-[var(--text-muted)] outline-none"
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-8">
        <PillControl label={payerName} icon={<IconUser className="size-3.5" />}>
          <select
            value={row.payerId}
            onChange={(e) => onChange({ payerId: e.target.value })}
            aria-label={t.payer}
            className="absolute inset-0 cursor-pointer opacity-0"
          >
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </PillControl>

        <button
          type="button"
          onClick={() => onChange({ expanded: !row.expanded })}
          aria-expanded={row.expanded}
          className="pill"
        >
          <IconUsers className="size-3.5 text-[var(--text-muted)]" />
          <span className="max-w-[7rem] truncate">{participantLabel}</span>
          <IconChevronDown className="size-3 text-[var(--text-muted)]" />
        </button>

        <PillControl
          label={dateFormat.format(new Date(`${row.date}T12:00:00`))}
          icon={<IconCalendar className="size-3.5" />}
        >
          <input
            type="date"
            value={row.date}
            onChange={(e) => e.target.value && onChange({ date: e.target.value })}
            onClick={(e) => {
              // An opacity-0 date input doesn't open its picker on click in every
              // browser — ask for it explicitly where that's supported.
              try {
                e.currentTarget.showPicker?.();
              } catch {
                /* not allowed here — the native focus behaviour still applies */
              }
            }}
            aria-label={t.date}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </PillControl>

        {rate !== null && row.currency !== base && amountCents != null && (
          <span className="text-xs tabular-nums text-[var(--text-muted)]">
            ≈ {formatCents(toBaseCents(amountCents, rate), base, intl)}
          </span>
        )}
      </div>

      {row.expanded && (
        <div className="mt-2 flex flex-wrap gap-1.5 pl-8">
          {members.map((member) => {
            const on = row.participants.includes(member.id);
            return (
              <button
                key={member.id}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  onChange({
                    participants: on
                      ? row.participants.filter((id) => id !== member.id)
                      : members.filter((m) => m.id === member.id || row.participants.includes(m.id))
                          .map((m) => m.id),
                  })
                }
                className="pill aria-pressed:border-[var(--accent)] aria-pressed:bg-[var(--accent)] aria-pressed:text-white"
              >
                {member.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * A compact chip whose whole surface is a transparent native control — keeps
 * the platform's own picker on mobile without spending a row of screen on it.
 */
function PillControl({
  label,
  icon,
  compact,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className={`pill relative ${compact ? "px-1.5" : ""}`}>
      <span className="text-[var(--text-muted)]">{icon}</span>
      {label && <span className="max-w-[7rem] truncate">{label}</span>}
      {!compact && <IconChevronDown className="size-3 text-[var(--text-muted)]" />}
      {children}
    </span>
  );
}
