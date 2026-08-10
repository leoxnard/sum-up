import { CATEGORIES } from "../categories";
import type { ExtractMember } from "../extract";

export interface PromptContext {
  baseCurrency: string;
  today: string;
  members: ExtractMember[];
  /** the member doing the importing, so "ich" / "I" can be resolved */
  speaker: string | null;
  /** spoken input needs a few rules that written input does not */
  spoken: boolean;
}

/**
 * The rules that turn a free-form description of spending into entries.
 *
 * Shared by the voice and the text importer: both get the same message from a
 * person in their own words, so a rule that is right for one is right for the
 * other, and having two copies would mean fixing every misread twice.
 */
export function entryRules(context: PromptContext): string {
  const { baseCurrency, today, members, speaker, spoken } = context;
  const who = spoken ? "speaker" : "writer";
  const names = members.map((m) => m.name);

  const lines = [
    "Rules:",
    `- kind: "payment" when money simply moved from one person to another — a repayment or`,
    `  a transfer, e.g. „zwei Euro von Leo an Fabi", „ich hab Anna die 10 Euro zurückgegeben",`,
    `  "Ben paid me back 20". Everything that was bought is kind "expense". A payment settles a`,
    "  debt and is never split; give it a payer, a recipient and no participants, no title and",
    "  no category.",
    `- One entry per distinct purchase. If the ${who} mentions several things bought in`,
    "  separate places or for separate purposes, split them into separate entries — even when",
    "  the amounts came in one sentence.",
    `- Keep one purchase as ONE entry when the ${who} only breaks down what was inside it`,
    `  (e.g. "40 euros at the supermarket, 12 of that was drinks") — book the total.`,
    `- If the ${who} corrects themselves, use the corrected value and ignore the first one.`,
    `- title: what it was for, short and in the ${who}'s language, e.g. „Supermarkt“, „Taxi“.`,
    `- amount: always positive, a plain decimal string with a dot, e.g. "24.50".`,
    spoken
      ? `  Spoken forms like "vierundzwanzig fünfzig", "24 euro 50" or "twenty-four fifty" all mean 24.50.`
      : `  Both "24,50" and "24.50" mean 24.50.`,
    `- currency: 3-letter ISO code. If no currency is given, use ${baseCurrency}.`,
    `- date: absolute ISO date yyyy-mm-dd. Today is ${today}. Resolve "heute"/"today" (= ${today}),`,
    `  "gestern"/"yesterday", "vorgestern", weekday names and phrases like "letzten Freitag" /`,
    `  "last Friday" against that. Omit the field when no time is mentioned at all.`,
    `- category: exactly one of ${CATEGORIES.join(", ")}. Omit it if genuinely unclear.`,
    `- note: only a detail the ${who} gave that does not fit the title and is worth keeping.`,
    "  Omit it otherwise — do not restate the title, the amount or the date.",
  ];

  if (names.length > 0) {
    lines.push(
      `- The group members are: ${names.join(", ")}.`,
      "- payer: the member who paid, exactly as spelled in that list. Omit it when the",
      `  ${who} does not say who paid.`,
      speaker
        ? `- The person importing is ${speaker}, so "ich" / "I" / "me" means ${speaker}.`
        : `- Omit payer when the ${who} only says "ich" / "I", since their name is unknown.`,
      "- recipient: for a payment, the member who received the money (the „an …“ / „to …“",
      "  side). Omit it for an expense.",
      "- participants: the members an expense is split between, spelled as in that list.",
      `  Use "everyone" when it is for the whole group, and omit the field when the ${who}`,
      "  does not say who it is for. When they do name people, list exactly those and nobody",
      `  else — „das war nur für Fabi" means participants: ["Fabi"], not the whole group.`,
      "- Names often come as short forms; return them as you got them and do not map them",
      "  onto a list entry yourself.",
    );
  }

  return lines.join("\n");
}
