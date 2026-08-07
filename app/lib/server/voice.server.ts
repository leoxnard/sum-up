import { runExtraction, type ExtractionResult } from "./extract.server";
import { CATEGORIES } from "../categories";
import type { ExtractMember } from "../extract";

/**
 * Read expenses out of a spoken message with Gemini's audio models.
 *
 * A voice message carries more than a receipt does — one message can describe
 * several purchases, name who paid and who is in on each of them — so the model
 * is asked for those too, along with a transcript the review screen shows so
 * the user can see what was actually heard. Nothing here is trusted: names come
 * back as text and are matched against the real member list, and every row is
 * editable before anything is written.
 */
export function extractExpensesFromVoice(
  dataUrl: string,
  baseCurrency: string,
  today: string,
  members: ExtractMember[],
  speaker: string | null,
): Promise<ExtractionResult> {
  return runExtraction({
    prompt: buildPrompt(baseCurrency, today, members, speaker),
    dataUrl,
    accept: "audio",
    baseCurrency,
    today,
    members,
    withPeople: true,
  });
}

function buildPrompt(
  baseCurrency: string,
  today: string,
  members: ExtractMember[],
  speaker: string | null,
): string {
  const names = members.map((m) => m.name);
  return [
    "You extract expenses from a voice message so they can be booked into a shared-expense app.",
    "Someone is talking about money they (or someone in their group) spent. The message can be",
    "in any language; it is usually German or English, often informal, and may contain filler,",
    "corrections and self-interruptions.",
    "",
    "First transcribe what is said, then turn it into expenses.",
    "",
    "Rules:",
    "- kind: \"payment\" when money simply moved from one person to another — a repayment or",
    `  a transfer, e.g. „zwei Euro von Leo an Fabi", „ich hab Anna die 10 Euro zurückgegeben",`,
    `  "Ben paid me back 20". Everything that was bought is kind "expense". A payment settles a`,
    "  debt and is never split; give it a payer, a recipient and no participants, no title and",
    "  no category.",
    "- One entry per distinct purchase. If the speaker mentions several things bought in",
    "  separate places or for separate purposes, split them into separate entries — even when",
    "  the amounts were said in one breath.",
    "- Keep one purchase as ONE entry when the speaker only breaks down what was inside it",
    `  (e.g. "40 euros at the supermarket, 12 of that was drinks") — book the total.`,
    "- If the speaker corrects themselves, use the corrected value and ignore the first one.",
    "- If the speaker says a total was split into named parts that are each their own expense,",
    "  return the parts, not the total.",
    "- title: what it was for, short and in the speaker's language, e.g. „Supermarkt“, „Taxi“.",
    `- amount: always positive, a plain decimal string with a dot, e.g. "24.50". Spoken forms`,
    `  like "vierundzwanzig fünfzig", "24 euro 50" or "twenty-four fifty" all mean 24.50.`,
    `- currency: 3-letter ISO code. If no currency is said, use ${baseCurrency}.`,
    `- date: absolute ISO date yyyy-mm-dd. Today is ${today}. Resolve "heute"/"today" (= ${today}),`,
    `  "gestern"/"yesterday", "vorgestern", weekday names and phrases like "letzten Freitag" /`,
    `  "last Friday" against that. Omit the field when no time is mentioned at all.`,
    `- category: exactly one of ${CATEGORIES.join(", ")}. Omit it if genuinely unclear.`,
    "- note: only a detail the speaker gave that does not fit the title and is worth keeping.",
    "  Omit it otherwise — do not restate the title, the amount or the date.",
    "",
    names.length > 0
      ? [
          `- The group members are: ${names.join(", ")}.`,
          "- payer: the member who paid, exactly as spelled in that list. Omit it when the",
          "  speaker does not say who paid.",
          speaker
            ? `- The person recording is ${speaker}, so "ich" / "I" / "me" means ${speaker}.`
            : `- Omit payer when the speaker only says "ich" / "I", since their name is unknown.`,
          "- recipient: for a payment, the member who received the money (the „an …“ / „to …“",
          "  side). Omit it for an expense.",
          "- participants: the members an expense is split between, spelled as in that list.",
          `  Use "everyone" when it is for the whole group, and omit the field when the speaker`,
          "  does not say who it is for. When they do name people, list exactly those and nobody",
          `  else — „das war nur für Fabi" means participants: ["Fabi"], not the whole group.`,
          "- Spoken names are often short forms; return them as you heard them and do not map",
          "  them onto a list entry yourself.",
        ].join("\n")
      : "",
    "",
    "If the message is not about spending money at all, return an empty expense list and still",
    "return the transcript.",
  ]
    .filter(Boolean)
    .join("\n");
}
