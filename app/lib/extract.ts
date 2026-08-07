import { CATEGORIES } from "./categories";
import { CURRENCIES, isCurrency } from "./currencies";
import { parseAmountToCents } from "./money";
import type { CategoryKey } from "./types";

/** One expense a model believes it found, already sanitized and ready to review. */
export interface ExtractedExpense {
  title: string;
  amountCents: number;
  currency: string;
  /** ISO yyyy-mm-dd, or null when the source shows no usable date */
  date: string | null;
  category: CategoryKey | null;
  note: string | null;
  /** member id the source named as the payer, or null to fall back to the default */
  payerId: string | null;
  /** member ids the source named as participants, or null for "everyone" */
  participantIds: string[] | null;
}

export interface Extraction {
  expenses: ExtractedExpense[];
  /** what the model heard, for a voice message; null for an image */
  transcript: string | null;
}

export interface ExtractMember {
  id: string;
  name: string;
}

/**
 * Response schema for the extraction call. `withPeople` adds the fields that
 * only a spoken message can plausibly fill (who paid, who is in, an aside worth
 * keeping, and the transcript itself) — an image is asked for none of them.
 */
export function extractionSchema(withPeople: boolean) {
  const item: Record<string, unknown> = {
    title: { type: "string" },
    amount: { type: "string" },
    currency: { type: "string" },
    date: { type: "string" },
    category: { type: "string" },
  };
  if (withPeople) {
    item.note = { type: "string" };
    item.payer = { type: "string" };
    item.participants = { type: "array", items: { type: "string" } };
  }
  const properties: Record<string, unknown> = {
    expenses: {
      type: "array",
      items: {
        type: "object",
        properties: item,
        required: ["title", "amount", "currency"],
      },
    },
  };
  if (withPeople) properties.transcript = { type: "string" };
  return { type: "object", properties, required: ["expenses"] };
}

export interface ParseOptions {
  baseCurrency: string;
  today: string;
  /** the group's members, so spoken names can be resolved to ids */
  members?: ExtractMember[];
}

/**
 * Turn the model's JSON into rows the review screen can show.
 *
 * Deliberately tolerant: the model is asked for strings and everything is
 * re-validated here, because the review screen — not the model — is what
 * actually decides what gets booked. A garbage row costs the user one tap.
 *
 * Null means "this wasn't usable JSON" (worth another model); an empty expense
 * list is a valid verdict.
 */
export function parseExtraction(text: string, options: ParseOptions): Extraction | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const raw = (parsed as { expenses?: unknown }).expenses;
  if (!Array.isArray(raw)) return null;

  const { baseCurrency, today, members = [] } = options;
  const expenses: ExtractedExpense[] = [];
  for (const item of raw.slice(0, 40)) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    const amountCents = parseAmountToCents(String(row.amount ?? ""));
    if (amountCents === null || amountCents <= 0) continue;

    const currencyRaw = String(row.currency ?? "").trim().toUpperCase();
    const currency = isCurrency(currencyRaw)
      ? currencyRaw
      : (CURRENCIES as readonly string[]).includes(baseCurrency)
        ? baseCurrency
        : "EUR";

    const categoryRaw = String(row.category ?? "").trim().toLowerCase();
    const category = CATEGORIES.find((c) => c === categoryRaw) ?? null;

    const dateRaw = String(row.date ?? "").trim();
    // Future dates are always a misread (nobody reports tomorrow's spending).
    const date =
      /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) && dateRaw <= today && dateRaw >= "2000-01-01"
        ? dateRaw
        : null;

    const title = String(row.title ?? "").trim().slice(0, 120);
    const note = String(row.note ?? "").trim().slice(0, 500);

    expenses.push({
      title: title || "?",
      amountCents,
      currency,
      date,
      category,
      note: note || null,
      payerId: matchMember(row.payer, members),
      participantIds: matchParticipants(row.participants, members),
    });
  }

  const transcript = String((parsed as { transcript?: unknown }).transcript ?? "")
    .trim()
    .slice(0, 4000);
  return { expenses, transcript: transcript || null };
}

/** Lowercase, unaccented, punctuation-free — "Jörg-Peter" and "jorg peter" meet here. */
function normalizeName(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Resolve a spoken name to a member id. Exact match first, then a unique first
 * name or prefix — an ambiguous name resolves to nothing rather than to the
 * wrong person, because the default (and the review screen) are both safer than
 * a confident guess about who owes money.
 */
export function matchMember(raw: unknown, members: ExtractMember[]): string | null {
  const needle = normalizeName(String(raw ?? ""));
  if (!needle || members.length === 0) return null;

  const normalized = members.map((m) => ({ id: m.id, name: normalizeName(m.name) }));
  const exact = normalized.filter((m) => m.name === needle);
  if (exact.length === 1) return exact[0].id;
  if (exact.length > 1) return null; // two members share a name — let the user pick

  if (needle.length < 2) return null;
  const partial = normalized.filter(
    (m) => m.name.split(" ")[0] === needle || m.name.startsWith(`${needle} `),
  );
  return partial.length === 1 ? partial[0].id : null;
}

const EVERYONE = new Set([
  "alle",
  "wir",
  "wir alle",
  "uns",
  "everyone",
  "everybody",
  "all",
  "all of us",
  "us",
  "the group",
  "die gruppe",
]);

/** Null means "nothing usable was named" — the caller's default (everyone) wins. */
function matchParticipants(raw: unknown, members: ExtractMember[]): string[] | null {
  if (!Array.isArray(raw) || members.length === 0) return null;
  const ids = new Set<string>();
  const named = new Set<string>();
  for (const entry of raw.slice(0, 60)) {
    const name = normalizeName(String(entry ?? ""));
    if (!name) continue;
    if (EVERYONE.has(name)) return members.map((m) => m.id);
    named.add(name);
    const id = matchMember(entry, members);
    if (id) ids.add(id);
  }
  // A single unmatched name would silently shrink the split — and someone left
  // out of a split pays nothing — so only a fully understood list is applied.
  if (named.size === 0 || ids.size !== named.size) return null;
  return members.filter((m) => ids.has(m.id)).map((m) => m.id);
}
