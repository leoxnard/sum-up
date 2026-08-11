import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useFetcher, useNavigate } from "react-router";

import type { Route } from "./+types/group.import";
import { useGroup } from "./group";
import { useT } from "../root";
import { sql } from "../lib/server/db.server";
import { extractExpensesFromImage } from "../lib/server/vision.server";
import { extractExpensesFromVoice } from "../lib/server/voice.server";
import { extractExpensesFromText } from "../lib/server/text.server";
import { CATEGORIES } from "../lib/categories";
import { CURRENCIES } from "../lib/currencies";
import { formatCents, parseAmountToCents, toBaseCents } from "../lib/money";
import { computeShares } from "../lib/split";
import { findDuplicates, type DuplicateMatch } from "../lib/duplicates";
import { categoryLabel } from "../lib/i18n";
import { resizeImage } from "../lib/client/image";
import { fromPasteEvent, readClipboard, type Pasted } from "../lib/client/clipboard";
import {
  canRecord,
  startRecording,
  toWavDataUrl,
  MAX_RECORDING_SECONDS,
  type Recorder,
} from "../lib/client/audio";
import { submitOp } from "../lib/client/outbox";
import { DuplicateLine } from "../components/DuplicateWarning";
import {
  CategoryIcon,
  IconAlert,
  IconArrowLeft,
  IconCalendar,
  IconArrowRight,
  IconChevronDown,
  IconExchange,
  IconClipboard,
  IconImage,
  IconMic,
  IconSparkles,
  IconStop,
  IconText,
  IconUser,
  IconUsers,
} from "../components/icons";
import { MAX_TEXT_LENGTH } from "../lib/extract";
import type { CategoryKey, SyncOp } from "../lib/types";

/** Widens the group shell — the review needs two columns on a big screen. */
export const handle = { wide: true };

const today = () => new Date().toISOString().slice(0, 10);

/** Which of the capture paths a submission came from. */
type Source = "image" | "voice" | "text";

export async function action({ request, params }: Route.ActionArgs) {
  let dataUrl = "";
  let text = "";
  let source: Source = "image";
  let meId: string | null = null;
  try {
    const body = (await request.json()) as {
      dataUrl?: unknown;
      text?: unknown;
      source?: unknown;
      meId?: unknown;
    };
    if (typeof body.dataUrl === "string") dataUrl = body.dataUrl;
    if (typeof body.text === "string") text = body.text;
    if (body.source === "voice" || body.source === "text") source = body.source;
    if (typeof body.meId === "string") meId = body.meId;
  } catch {
    return { ok: false as const, error: "unreadable" as const };
  }
  if (source === "text") {
    if (!text.trim()) return { ok: false as const, error: "unreadable" as const };
    if (text.length > MAX_TEXT_LENGTH) return { ok: false as const, error: "too_large" as const };
  } else if (!dataUrl || dataUrl.length > 6_000_000) {
    // Bounded well below the serverless body limit; the client resizes the image
    // and records mono 16 kHz audio, both of which stay far under this.
    return { ok: false as const, error: "too_large" as const };
  }

  // The slug is the credential, exactly like everywhere else — and it's also
  // where the base currency comes from, so the client can't influence it.
  const rows = await sql<{ id: string; base_currency: string }[]>`
    select id, base_currency from groups where slug = ${params.slug} and deleted_at is null
  `;
  if (rows.length === 0) throw new Response("Not found", { status: 404 });
  const group = rows[0];

  if (source === "voice" || source === "text") {
    // Member names come from the database, never from the request: they are what
    // a named person is matched against, and the match decides who owes money.
    const members = await sql<{ id: string; name: string }[]>`
      select id, name from members
      where group_id = ${group.id} and deleted_at is null
      order by created_at
    `;
    const speaker = members.find((m) => m.id === meId)?.name ?? null;
    const described =
      source === "voice"
        ? await extractExpensesFromVoice(dataUrl, group.base_currency, today(), members, speaker)
        : await extractExpensesFromText(text, group.base_currency, today(), members, speaker);
    if (!described.ok) return { ok: false as const, error: described.error };
    return {
      ok: true as const,
      expenses: described.expenses,
      // The written message is already on screen; only speech needs a transcript.
      transcript: source === "voice" ? described.transcript : null,
    };
  }

  const result = await extractExpensesFromImage(dataUrl, group.base_currency, today());
  if (!result.ok) return { ok: false as const, error: result.error };
  return { ok: true as const, expenses: result.expenses, transcript: null };
}

interface Row {
  id: string;
  selected: boolean;
  /** a payment is a repayment between two members: no split, no category */
  kind: "expense" | "payment";
  recipientId: string;
  title: string;
  amountRaw: string;
  currency: string;
  date: string;
  category: CategoryKey;
  /** the user picked the category themselves — teaches the group's override table */
  categoryTouched: boolean;
  note: string;
  payerId: string;
  participants: string[];
  expanded: boolean;
}

export default function ImportExpenses() {
  const { snapshot, me, offline } = useGroup();
  const { t, intl } = useT();
  const navigate = useNavigate();
  const fetcher = useFetcher<typeof action>();
  const group = snapshot.group;
  const members = snapshot.members;
  const base = group.baseCurrency;

  const defaultPayer = me && members.some((m) => m.id === me) ? me : (members[0]?.id ?? "");
  const allMemberIds = useMemo(() => members.map((m) => m.id), [members]);

  const [source, setSource] = useState<Source>("image");
  const [image, setImage] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [submittedText, setSubmittedText] = useState("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [rates, setRates] = useState<Record<string, { raw: string; failed: boolean }>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const recorder = useRef<Recorder | null>(null);
  const startedAt = useRef(0);

  const analyzing = fetcher.state !== "idle";

  // Turn a finished extraction into editable rows. Whatever the source named
  // wins; everything it left open falls back to the common case — whoever is
  // importing paid, split equally between everyone.
  useEffect(() => {
    const data = fetcher.data;
    if (!data) return;
    if (!data.ok) {
      // Same failure, three different things to say about it.
      const tooBig = { image: t.importTooLarge, voice: t.voiceTooLong, text: t.textTooLong };
      const failed = { image: t.importFailed, voice: t.voiceFailed, text: t.textFailed };
      setError(
        data.error === "no_key"
          ? t.importUnavailable
          : data.error === "too_large"
            ? tooBig[source]
            : failed[source],
      );
      setRows(null);
      return;
    }
    setError(null);
    setTranscript(data.transcript);
    setRows(
      data.expenses.map((expense) => ({
        id: crypto.randomUUID(),
        selected: true,
        kind: expense.kind,
        recipientId:
          expense.recipientId && members.some((m) => m.id === expense.recipientId)
            ? expense.recipientId
            : "",
        title: expense.title,
        amountRaw: (expense.amountCents / 100).toFixed(2),
        currency: expense.currency,
        date: expense.date ?? today(),
        category: expense.category ?? "other",
        categoryTouched: false,
        note: expense.note ?? "",
        payerId:
          expense.payerId && members.some((m) => m.id === expense.payerId)
            ? expense.payerId
            : defaultPayer,
        participants: expense.participantIds?.length ? expense.participantIds : allMemberIds,
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

  function reset(next: Source) {
    setSource(next);
    setRows(null);
    setTranscript(null);
    setError(null);
    setImage(null);
    if (next !== "text") setSubmittedText("");
    setAudioUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
  }

  /** Everything is online-only: the model lives on the server. */
  function requireConnection(): boolean {
    if (offline || !navigator.onLine) {
      setError(t.importOffline);
      return false;
    }
    return true;
  }

  async function onPickFile(file: File) {
    reset("image");
    if (!requireConnection()) return;
    let dataUrl: string;
    try {
      dataUrl = await resizeImage(file, 1500, 0.8);
    } catch {
      // Formats the browser can't decode (some HEIC/RAW pickers) land here.
      setError(t.importFailed);
      return;
    }
    setImage(dataUrl);
    fetcher.submit({ dataUrl, source: "image" }, { method: "post", encType: "application/json" });
  }

  function onSubmitText(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    reset("text");
    setText(trimmed);
    setSubmittedText(trimmed);
    if (!requireConnection()) return;
    fetcher.submit(
      { text: trimmed.slice(0, MAX_TEXT_LENGTH), source: "text", meId: me ?? null },
      { method: "post", encType: "application/json" },
    );
  }

  /**
   * Whatever is in the clipboard, taken as far as it goes on its own: an image
   * is read, shrunk and sent without a second tap, text starts the same way.
   */
  async function onPaste(pasted: Pasted) {
    if (pasted.kind === "text") {
      onSubmitText(pasted.text);
      return;
    }
    if (pasted.kind === "empty") {
      setError(t.pasteEmpty);
      return;
    }
    reset("image");
    if (!requireConnection()) return;
    let dataUrl: string;
    try {
      dataUrl = await resizeImage(pasted.blob, 1500, 0.8);
    } catch {
      setError(t.importFailed);
      return;
    }
    setImage(dataUrl);
    fetcher.submit({ dataUrl, source: "image" }, { method: "post", encType: "application/json" });
  }

  async function onPasteButton() {
    setError(null);
    try {
      await onPaste(await readClipboard());
    } catch {
      // No permission, or a browser that only pastes through the keyboard.
      setError(t.pasteDenied);
    }
  }

  // ⌘V / Strg+V anywhere on the pick screen does the same thing as the button,
  // which is how a screenshot actually reaches this page on a desktop.
  useEffect(() => {
    if (rows !== null || recording || analyzing) return;
    const onDocumentPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      // Inside the text box, a paste is an ordinary paste.
      if (target?.tagName === "TEXTAREA" || target?.tagName === "INPUT") return;
      const pasted = fromPasteEvent(event);
      if (pasted.kind === "empty") return;
      event.preventDefault();
      void onPaste(pasted);
    };
    document.addEventListener("paste", onDocumentPaste);
    return () => document.removeEventListener("paste", onDocumentPaste);
    // onPaste closes over the fetcher and the translations, both stable enough
    // for the lifetime of the pick screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, recording, analyzing]);

  async function onStartRecording() {
    reset("voice");
    if (!requireConnection()) return;
    if (!canRecord()) {
      setError(t.voiceUnsupported);
      return;
    }
    try {
      recorder.current = await startRecording();
    } catch (failure) {
      setError(
        failure instanceof Error && failure.message === "denied"
          ? t.voiceDenied
          : t.voiceUnsupported,
      );
      return;
    }
    startedAt.current = Date.now();
    setElapsed(0);
    setLevel(0);
    setRecording(true);
  }

  const onStopRecording = useCallback(
    async function onStopRecording() {
      const active = recorder.current;
      if (!active) return;
      recorder.current = null;
      setRecording(false);
      let blob: Blob;
      try {
        blob = await active.stop();
      } catch {
        setError(t.voiceFailed);
        return;
      }
      let dataUrl: string;
      try {
        dataUrl = await toWavDataUrl(blob);
      } catch {
        setError(t.voiceFailed);
        return;
      }
      // The original recording (not the 16 kHz mono copy) is what the user gets
      // to play back while reviewing.
      setAudioUrl(URL.createObjectURL(blob));
      fetcher.submit(
        { dataUrl, source: "voice", meId: me ?? null },
        { method: "post", encType: "application/json" },
      );
    },
    [fetcher, me, t],
  );

  function onDiscardRecording() {
    recorder.current?.cancel();
    recorder.current = null;
    setRecording(false);
  }

  // Drive the timer and the level meter, and stop by itself at the cap rather
  // than letting someone record a monologue we then can't upload.
  useEffect(() => {
    if (!recording) return;
    const id = window.setInterval(() => {
      const seconds = (Date.now() - startedAt.current) / 1000;
      setElapsed(seconds);
      setLevel(recorder.current?.level() ?? 0);
      if (seconds >= MAX_RECORDING_SECONDS) void onStopRecording();
    }, 100);
    return () => window.clearInterval(id);
  }, [recording, onStopRecording]);

  // Leaving mid-recording must release the microphone.
  useEffect(
    () => () => {
      recorder.current?.cancel();
      recorder.current = null;
    },
    [],
  );

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

  // A scan of a bank statement happily re-reads days that were already booked,
  // so every row is checked against the group before it can be added.
  const duplicates = useMemo(() => {
    const found = new Map<string, DuplicateMatch[]>();
    for (const row of rows ?? []) {
      // Repaying the same person the same amount twice is a normal thing to
      // record, so payments are left out of the check entirely.
      if (row.kind === "payment") continue;
      const cents = parseAmountToCents(row.amountRaw);
      const rate = rateFor(row.currency);
      if (!cents || cents <= 0 || !rate) continue;
      const matches = findDuplicates(
        { title: row.title, amountBaseCents: toBaseCents(cents, rate), date: row.date },
        snapshot.entries,
      );
      if (matches.length > 0) found.set(row.id, matches);
    }
    return found;
    // rateFor closes over `rates`, which is in the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, rates, base, snapshot.entries]);

  const flaggedSelected = selected.filter((row) => duplicates.has(row.id));
  const hasPayment = (rows ?? []).some((row) => row.kind === "payment");

  const memberName = useMemo(
    () => new Map(members.map((m) => [m.id, m.name])),
    [members],
  );

  async function onAdd() {
    if (selected.length === 0) {
      setError(t.errImportNoneSelected);
      return;
    }
    const ops: SyncOp[] = [];
    for (const row of selected) {
      const amountCents = parseAmountToCents(row.amountRaw);
      const rate = rateFor(row.currency);
      const payment = row.kind === "payment";
      // A payment moves the whole amount from one member to another, so it has
      // no split at all; an expense needs one that covers its participants.
      const split =
        amountCents && !payment
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
      const usable = payment
        ? Boolean(row.recipientId) && row.recipientId !== row.payerId
        : Boolean(split?.ok) && Boolean(row.title.trim());
      if (!amountCents || amountCents <= 0 || !rate || !usable) {
        setError(t.errImportRow(rowLabel(row, memberName, t)));
        return;
      }
      ops.push({
        op: "upsert_entry",
        slug: group.slug,
        clientUpdatedAt: Date.now(),
        groupId: group.id,
        entry: {
          id: row.id,
          kind: row.kind,
          title: payment ? null : row.title.trim(),
          note: row.note.trim() || null,
          category: payment ? null : row.category,
          // A reviewed guess is trustworthy enough to keep, but only a
          // deliberate pick teaches the group's learned categories.
          categorySource: payment ? null : row.categoryTouched ? "manual" : "llm",
          payerId: row.payerId,
          recipientId: payment ? row.recipientId : null,
          amountCents,
          currency: row.currency,
          exchangeRate: rate,
          splitMode: "equal",
          expenseDate: row.date,
          shares: split?.ok ? split.shares : [],
        },
        // A single-expense image is a receipt for that expense — keep it. For a
        // transaction list the same screenshot on every entry is just noise,
        // and a voice message is no one's receipt.
        photoDataUrl: source === "image" && selected.length === 1 ? image : null,
        photoChanged: source === "image" && selected.length === 1 && image !== null,
      });
    }
    setSaving(true);
    for (const op of ops) await submitOp(op);
    navigate(`/g/${group.slug}`);
  }

  // The action bar only exists once there are rows to confirm; before that the
  // same clearance would just be dead space to scroll past.
  const barVisible = rows !== null && rows.length > 0;

  return (
    <main className={`px-4 pt-6 ${barVisible ? "pb-action-bar" : "pb-16"}`}>
      <header className="animate-rise flex items-center gap-1">
        <Link to={`/g/${group.slug}`} aria-label={t.cancel} className="btn-icon -ml-2.5 shrink-0">
          <IconArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-xl font-bold tracking-tight">
          {t.importTitle}
        </h1>
      </header>

      {rows === null ? (
        <PickScreen
          analyzing={analyzing}
          source={source}
          image={image}
          text={text}
          recording={recording}
          elapsed={elapsed}
          level={level}
          error={error}
          onTextChange={setText}
          onSubmitText={() => onSubmitText(text)}
          onPasteClipboard={() => void onPasteButton()}
          onPickImage={() => fileInput.current?.click()}
          onStartRecording={() => void onStartRecording()}
          onStopRecording={() => void onStopRecording()}
          onDiscardRecording={onDiscardRecording}
        />
      ) : (
        <div className="mt-5 gap-6 md:grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:items-start">
          <figure className="md:sticky md:top-6">
            {source === "image" ? (
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
            ) : source === "text" ? (
              <div className="card bg-[var(--surface-sunken)]">
                <p className="max-h-56 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed md:max-h-[50vh]">
                  {submittedText}
                </p>
              </div>
            ) : (
              <div className="card bg-[var(--surface-sunken)]">
                {audioUrl && (
                  <audio src={audioUrl} controls className="w-full" aria-label={t.voiceRecording} />
                )}
                {/* What the model heard. Seeing it is how a misread amount gets
                    explained instead of just looking wrong. */}
                <p className="mt-3 max-h-56 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-muted)] md:max-h-[50vh]">
                  {transcript || t.voiceNoTranscript}
                </p>
              </div>
            )}
            <figcaption className="mt-1.5 flex items-center justify-between px-1 text-xs text-[var(--text-muted)]">
              <span>
                {source === "image"
                  ? t.importOriginal
                  : source === "text"
                    ? t.textOriginal
                    : t.voiceTranscript}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (source === "image") {
                    reset("image");
                    fileInput.current?.click();
                  } else if (source === "text") {
                    // Back to the box with the text still in it, ready to fix.
                    setRows(null);
                    setError(null);
                  } else {
                    reset("voice");
                    void onStartRecording();
                  }
                }}
                className="font-medium underline underline-offset-2"
              >
                {source === "image"
                  ? t.importRetry
                  : source === "text"
                    ? t.textEdit
                    : t.voiceRetry}
              </button>
            </figcaption>
          </figure>

          <section className="mt-5 md:mt-0">
            {rows.length === 0 ? (
              <div className="card px-4 py-8 text-center text-sm text-[var(--text-muted)]">
                <p>
                  {source === "image"
                    ? t.importNothingFound
                    : source === "text"
                      ? t.textNothingFound
                      : t.voiceNothingFound}
                </p>
                {source !== "image" && <p className="mt-1 text-xs">{t.voiceNothingHint}</p>}
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="section-label">
                    {hasPayment ? t.importFoundEntries(rows.length) : t.importFound(rows.length)}
                  </h2>
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

                {flaggedSelected.length > 0 && (
                  <div className="animate-pop mt-3 flex items-center gap-2 rounded-[var(--radius-control)] border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
                    <IconAlert className="size-[1.15em] shrink-0" />
                    <span className="min-w-0 flex-1">
                      {t.importDupFound(flaggedSelected.length)}
                    </span>
                    {/* Deselecting is a suggestion the user triggers — nothing
                        is dropped behind their back. */}
                    <button
                      type="button"
                      onClick={() =>
                        setRows(
                          rows.map((r) =>
                            duplicates.has(r.id) ? { ...r, selected: false } : r,
                          ),
                        )
                      }
                      className="shrink-0 font-semibold underline underline-offset-2"
                    >
                      {t.importDupDeselect}
                    </button>
                  </div>
                )}

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
                      memberName={memberName}
                      base={base}
                      rate={rateFor(row.currency)}
                      matches={duplicates.get(row.id) ?? []}
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

                {source === "image" && selected.length === 1 && image && (
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

      {barVisible && (
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
              {hasPayment
                ? t.importAddEntries(selected.length)
                : t.importAddSelected(selected.length)}
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

/** How a row is named in an error: its title, or the two sides of a payment. */
function rowLabel(
  row: Row,
  memberName: Map<string, string>,
  t: { payment: string },
): string {
  if (row.kind === "expense") return row.title.trim() || "?";
  const from = memberName.get(row.payerId) ?? "?";
  const to = memberName.get(row.recipientId) ?? "?";
  return `${t.payment}: ${from} → ${to}`;
}

function clock(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function PickScreen({
  analyzing,
  source,
  image,
  text,
  recording,
  elapsed,
  level,
  error,
  onTextChange,
  onSubmitText,
  onPasteClipboard,
  onPickImage,
  onStartRecording,
  onStopRecording,
  onDiscardRecording,
}: {
  analyzing: boolean;
  source: Source;
  image: string | null;
  text: string;
  recording: boolean;
  elapsed: number;
  level: number;
  error: string | null;
  onTextChange: (value: string) => void;
  onSubmitText: () => void;
  onPasteClipboard: () => void;
  onPickImage: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onDiscardRecording: () => void;
}) {
  const { t } = useT();

  if (recording) {
    const left = Math.max(0, MAX_RECORDING_SECONDS - elapsed);
    return (
      <div className="animate-rise mx-auto mt-10 max-w-lg text-center">
        <button
          type="button"
          onClick={onStopRecording}
          aria-label={t.voiceStop}
          className="relative mx-auto flex size-28 items-center justify-center rounded-full bg-rose-500 text-white shadow-lg"
        >
          {/* The ring follows the microphone, so silence is visible as silence. */}
          <span
            aria-hidden
            style={{ transform: `scale(${1 + level * 0.35})` }}
            className="absolute inset-0 rounded-full bg-rose-500/30 transition-transform duration-100"
          />
          <IconStop className="relative size-9" />
        </button>
        <p className="mt-6 text-2xl font-semibold tabular-nums">{clock(elapsed)}</p>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {left <= 15 ? t.voiceTimeLeft(Math.ceil(left)) : t.voiceRecordingHint}
        </p>
        <button
          type="button"
          onClick={onDiscardRecording}
          className="btn btn-neutral mt-8 w-full"
        >
          {t.voiceDiscard}
        </button>
      </div>
    );
  }

  if (analyzing) {
    return (
      <div className="animate-rise mx-auto mt-6 max-w-lg text-center">
        {source === "image" && image ? (
          <div className="card relative mx-auto overflow-hidden">
            <img src={image} alt="" className="max-h-72 w-full object-contain opacity-60" />
            {/* A sweep across the image while the model reads it. */}
            <span
              aria-hidden
              className="animate-scan pointer-events-none absolute inset-x-0 h-24 bg-gradient-to-b from-transparent via-[var(--accent)]/25 to-transparent"
            />
          </div>
        ) : (
          <span className="glyph mx-auto mb-4 flex size-14 items-center justify-center">
            {source === "voice" ? (
              <IconMic className="size-7 animate-pulse text-[var(--accent)]" />
            ) : (
              <IconText className="size-7 animate-pulse text-[var(--accent)]" />
            )}
          </span>
        )}
        <p className="mt-5 flex items-center justify-center gap-2 font-medium">
          <IconSparkles className="size-5 animate-pulse text-[var(--accent)]" />
          {source === "image"
            ? t.importAnalyzing
            : source === "voice"
              ? t.voiceAnalyzing
              : t.textAnalyzing}
        </p>
        <p className="mt-1 text-sm text-[var(--text-muted)]">{t.importAnalyzingHint}</p>
      </div>
    );
  }

  return (
    <div className="animate-rise mx-auto mt-6 max-w-lg text-center">
      <span className="glyph mx-auto mb-4 flex size-14 items-center justify-center">
        <IconSparkles className="size-7 text-[var(--accent)]" />
      </span>
      <p className="text-sm text-[var(--text-muted)]">{t.importIntro}</p>
      {error && (
        <p className="animate-pop mt-4 rounded-xl bg-rose-500/10 px-3.5 py-2.5 text-sm font-medium text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}

      <div className="card mt-6 p-2 text-left">
        <textarea
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; a real newline is still one modifier away.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmitText();
            }
          }}
          rows={3}
          maxLength={MAX_TEXT_LENGTH}
          placeholder={t.textPlaceholder}
          aria-label={t.textOriginal}
          className="w-full resize-none bg-transparent px-1.5 py-1 text-sm outline-none placeholder:text-[var(--text-muted)]"
        />
        <div className="flex items-center gap-2">
          {/* Always rendered: whether the browser will hand over the clipboard is
              only knowable on the client, and hiding the button after hydration
              would both flicker and mismatch the server's HTML. A browser that
              refuses says so, and ⌘V still works. */}
          <button
            type="button"
            onClick={onPasteClipboard}
            className="btn btn-neutral shrink-0"
            title={t.pasteHint}
          >
            <IconClipboard className="size-[1.15em]" />
            {t.pasteClipboard}
          </button>
          <button
            type="button"
            onClick={onSubmitText}
            disabled={!text.trim()}
            className="btn btn-primary ml-auto"
          >
            {t.textSubmit}
          </button>
        </div>
      </div>
      <p className="mt-2 text-xs text-[var(--text-muted)]">{t.pasteHint}</p>

      <div className="mt-5 flex flex-col gap-2.5">
        <button onClick={onStartRecording} className="btn btn-primary btn-lg w-full">
          <IconMic className="size-[1.15em]" />
          {t.voiceRecord}
        </button>
        <button onClick={onPickImage} className="btn btn-neutral btn-lg w-full">
          <IconImage className="size-[1.15em]" />
          {t.importPickImage}
        </button>
      </div>
      <p className="mt-3 text-xs text-[var(--text-muted)]">{t.voiceIntroHint}</p>
    </div>
  );
}

function ExpenseRow({
  row,
  index,
  members,
  memberName,
  base,
  rate,
  matches,
  onChange,
}: {
  row: Row;
  index: number;
  members: { id: string; name: string }[];
  memberName: Map<string, string>;
  base: string;
  rate: number | null;
  matches: DuplicateMatch[];
  onChange: (patch: Partial<Row>) => void;
}) {
  const { t, intl } = useT();
  const dateFormat = new Intl.DateTimeFormat(intl, { day: "numeric", month: "short" });
  const amountCents = parseAmountToCents(row.amountRaw);
  const payment = row.kind === "payment";
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
      className={`card px-2.5 py-2 transition-opacity ${row.selected ? "" : "opacity-45"} ${
        matches.length > 0 ? "border-amber-500/40" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={row.selected}
          onChange={(e) => onChange({ selected: e.target.checked })}
          aria-label={payment ? t.payment : row.title}
          className="checkbox shrink-0"
        />
        {payment ? (
          <>
            {/* A repayment has no title and no category — what it is, is who it
                went to, so the recipient takes the title's place. */}
            <span className="pill px-1.5">
              <IconExchange className="size-[1.05rem] text-[var(--text-muted)]" />
            </span>
            <IconArrowRight className="size-3.5 shrink-0 text-[var(--text-muted)]" />
            <select
              value={row.recipientId}
              onChange={(e) => onChange({ recipientId: e.target.value })}
              aria-label={t.recipient}
              className="min-w-0 flex-1 cursor-pointer bg-transparent font-medium outline-none"
            >
              <option value="" disabled>
                —
              </option>
              {members
                .filter((m) => m.id !== row.payerId)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </>
        ) : (
          <>
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
          </>
        )}
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
            onChange={(e) =>
              onChange({
                payerId: e.target.value,
                // Nobody pays themselves back.
                ...(e.target.value === row.recipientId ? { recipientId: "" } : null),
              })
            }
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
          {payment ? (
            <>
              <IconExchange className="size-3.5 text-[var(--text-muted)]" />
              <span>{t.payment}</span>
            </>
          ) : (
            <>
              <IconUsers className="size-3.5 text-[var(--text-muted)]" />
              <span className="max-w-[7rem] truncate">{participantLabel}</span>
            </>
          )}
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

      {/* A spoken aside ends up here — visible without expanding, because it's
          part of what the user is being asked to check. */}
      {row.note.trim() && !row.expanded && (
        <p className="mt-1 truncate pl-8 text-xs text-[var(--text-muted)]">{row.note}</p>
      )}

      <DuplicateLine matches={matches} memberName={memberName} className="mt-1.5 pl-8" />

      {row.expanded && (
        <div className="mt-2 pl-8">
          {/* Whether this is spending or a repayment is the model's guess like
              everything else here, so it can be corrected in place. */}
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              aria-pressed={!payment}
              onClick={() => onChange({ kind: "expense" })}
              className="pill aria-pressed:border-[var(--accent)] aria-pressed:bg-[var(--accent)] aria-pressed:text-white"
            >
              {t.addExpense}
            </button>
            <button
              type="button"
              aria-pressed={payment}
              onClick={() =>
                onChange({
                  kind: "payment",
                  // Falling back to the one person it could plausibly be beats
                  // an empty picker, but it is still visible and changeable.
                  recipientId:
                    row.recipientId ||
                    (row.participants.length === 1 && row.participants[0] !== row.payerId
                      ? row.participants[0]
                      : ""),
                })
              }
              className="pill aria-pressed:border-[var(--accent)] aria-pressed:bg-[var(--accent)] aria-pressed:text-white"
            >
              {t.payment}
            </button>
          </div>
          {!payment && (
            <div className="mt-2 flex flex-wrap gap-1.5">
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
                          : members
                              .filter((m) => m.id === member.id || row.participants.includes(m.id))
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
          <input
            value={row.note}
            onChange={(e) => onChange({ note: e.target.value })}
            placeholder={t.note}
            aria-label={t.note}
            className="mt-2 w-full bg-transparent text-sm outline-none placeholder:text-[var(--text-muted)]"
          />
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
