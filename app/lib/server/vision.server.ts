import { modelChain } from "./gemini.server";
import { CATEGORIES } from "../categories";
import { CURRENCIES, isCurrency } from "../currencies";
import { parseAmountToCents } from "../money";
import type { CategoryKey } from "../types";

/** One expense the model believes it found in the image, already sanitized. */
export interface ExtractedExpense {
  title: string;
  amountCents: number;
  currency: string;
  /** ISO yyyy-mm-dd, or null when the image shows no usable date */
  date: string | null;
  category: CategoryKey | null;
  note: string | null;
}

export type ExtractionResult =
  | { ok: true; expenses: ExtractedExpense[] }
  | { ok: false; error: "no_key" | "unavailable" | "unreadable" };

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    expenses: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          amount: { type: "string" },
          currency: { type: "string" },
          date: { type: "string" },
          category: { type: "string" },
        },
        required: ["title", "amount", "currency"],
      },
    },
  },
  required: ["expenses"],
} as const;

/**
 * Read expenses off a photo or screenshot with Gemini's vision models.
 *
 * Deliberately tolerant: the model is asked for strings and everything is
 * re-validated here, because the review screen — not the model — is what
 * actually decides what gets booked. A garbage row costs the user one tap.
 */
export async function extractExpensesFromImage(
  dataUrl: string,
  baseCurrency: string,
  today: string,
): Promise<ExtractionResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, error: "no_key" };

  const match = /^data:(image\/[a-z+.-]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) return { ok: false, error: "unreadable" };
  const [, mimeType, base64] = match;

  const prompt = buildPrompt(baseCurrency, today);
  let sawResponse = false;
  // Vision calls are slow enough that walking the whole model chain can outlive
  // the serverless function. Spend at most this much wall clock on the attempt
  // and report "unavailable" rather than getting killed mid-request.
  const deadline = Date.now() + 40_000;

  for (const model of modelChain()) {
    const budget = deadline - Date.now();
    if (budget < 5_000) break;
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: prompt }, { inlineData: { mimeType, data: base64 } }],
              },
            ],
            generationConfig: {
              temperature: 0,
              maxOutputTokens: 4096,
              responseMimeType: "application/json",
              responseSchema: RESPONSE_SCHEMA,
            },
          }),
          signal: AbortSignal.timeout(Math.min(25_000, budget)),
        },
      );
      if (response.status === 429 || response.status >= 500) continue; // next model
      if (!response.ok) return { ok: false, error: "unavailable" };
      sawResponse = true;
      const data = (await response.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = data.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? "")
        .join("")
        .trim();
      if (!text) continue; // empty completion — try the next model
      const expenses = parseExpenses(text, baseCurrency, today);
      if (expenses === null) continue; // unparseable — try the next model
      return { ok: true, expenses };
    } catch {
      continue; // timeout/network -> next model
    }
  }
  return { ok: false, error: sawResponse ? "unreadable" : "unavailable" };
}

function buildPrompt(baseCurrency: string, today: string): string {
  return [
    "You extract expenses from an image so they can be booked into a shared-expense app.",
    "The image is either a screenshot of a banking / payment app transaction list (it can",
    "contain several expenses), a photo or screenshot of a receipt or invoice (that is ONE",
    "expense — its total, never the individual line items), or any other screen that shows",
    "what someone paid.",
    "",
    "Rules:",
    "- Return one entry per payment actually made. Ignore incoming money, refunds, positive",
    "  amounts, account balances, running totals, per-day or per-section sums, and any",
    `  heading-like number (e.g. a balance next to "Kontostand" / "Balance").`,
    "- title: the merchant or purpose as shown, cleaned up (no times, no card numbers).",
    `- amount: always positive, as a plain decimal string with a dot, e.g. "24.24".`,
    "- If a transaction shows two amounts in different currencies, use the one in the",
    "  account's own currency — the visually primary one, usually listed first and larger —",
    "  and not the foreign original.",
    `- currency: 3-letter ISO code of the amount you returned. If none is visible, use ${baseCurrency}.`,
    `- date: absolute ISO date yyyy-mm-dd. Today is ${today}. Resolve relative headings like`,
    `  "Heute"/"Today" (= ${today}), "Gestern"/"Yesterday" (= yesterday) and weekday names,`,
    "  and apply a date heading to every transaction listed underneath it. If a date has no",
    "  year, pick the most recent one that is not in the future. Omit the field if unknown.",
    `- category: exactly one of ${CATEGORIES.join(", ")}. Omit it if genuinely unclear.`,
    "",
    "If the image contains no expense at all, return an empty list.",
  ].join("\n");
}

/** Null means "this wasn't usable JSON" (worth another model); [] is a valid verdict. */
function parseExpenses(
  text: string,
  baseCurrency: string,
  today: string,
): ExtractedExpense[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const raw = (parsed as { expenses?: unknown })?.expenses;
  if (!Array.isArray(raw)) return null;

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
    // Future dates are always a misread (nobody screenshots tomorrow's spending).
    const date =
      /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) && dateRaw <= today && dateRaw >= "2000-01-01"
        ? dateRaw
        : null;

    const title = String(row.title ?? "").trim().slice(0, 120);
    expenses.push({
      title: title || "?",
      amountCents,
      currency,
      date,
      category,
      note: null,
    });
  }
  return expenses;
}
