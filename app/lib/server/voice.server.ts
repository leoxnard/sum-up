import { runExtraction, type ExtractionResult } from "./extract.server";
import { entryRules } from "./prompt.server";
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
  return [
    "You extract expenses from a voice message so they can be booked into a shared-expense app.",
    "Someone is talking about money they (or someone in their group) spent. The message can be",
    "in any language; it is usually German or English, often informal, and may contain filler,",
    "corrections and self-interruptions.",
    "",
    "First transcribe what is said, then turn it into expenses.",
    "",
    entryRules({ baseCurrency, today, members, speaker, spoken: true }),
    "",
    "If the message is not about spending money at all, return an empty expense list and still",
    "return the transcript.",
  ].join("\n");
}
