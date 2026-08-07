import { runExtraction, type ExtractionResult } from "./extract.server";
import { CATEGORIES } from "../categories";

export type { ExtractionResult };

/**
 * Read expenses off a photo or screenshot with Gemini's vision models.
 *
 * Everything the model returns is re-validated in `parseExtraction`, because
 * the review screen — not the model — decides what actually gets booked.
 */
export function extractExpensesFromImage(
  dataUrl: string,
  baseCurrency: string,
  today: string,
): Promise<ExtractionResult> {
  return runExtraction({
    prompt: buildPrompt(baseCurrency, today),
    dataUrl,
    accept: "image",
    baseCurrency,
    today,
  });
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
