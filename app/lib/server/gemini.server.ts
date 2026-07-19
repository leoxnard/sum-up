import { sql } from "./db.server";
import { CATEGORIES } from "../categories";
import { normalizeTitle } from "../categories";
import { ringDoorbell } from "./doorbell.server";
import type { LlmCandidate } from "./sync.server";
import type { CategoryKey } from "../types";

// "-latest" aliases stay valid as Google rotates models under them; verified
// working against a fresh free-tier API key (dated gemini-2.5-* ids were
// rejected as "no longer available to new users", and pro requires billing).
const DEFAULT_MODELS = ["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-3.1-flash-lite"];

function modelChain(): string[] {
  const fromEnv = process.env.GEMINI_MODELS;
  if (!fromEnv) return DEFAULT_MODELS;
  return fromEnv.split(",").map((m) => m.trim()).filter(Boolean);
}

/**
 * Async categorization pass. Never throws; never blocks a save — callers
 * fire-and-forget (or waitUntil on Vercel). On success updates the row and
 * rings the doorbell so open clients see the refined category.
 */
export async function categorizeWithGemini(candidates: LlmCandidate[]): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || candidates.length === 0) return;

  for (const candidate of candidates) {
    try {
      const category = await askGemini(apiKey, candidate.title, candidate.note);
      if (!category) continue;
      // Only overwrite if the user hasn't categorized manually in the meantime.
      const updated = await sql`
        update entries set category = ${category}, category_source = 'llm'
        where id = ${candidate.entryId} and deleted_at is null
          and (category_source is null or category_source = 'keyword')
      `;
      if (updated.count > 0) {
        // Cache the verdict so identical titles skip the API next time.
        await sql`
          insert into category_overrides (group_id, title_normalized, category, updated_at)
          values (${candidate.groupId}, ${normalizeTitle(candidate.title)}, ${category}, now())
          on conflict (group_id, title_normalized) do nothing
        `;
        await ringDoorbell([candidate.slug]);
      }
    } catch {
      // Expense stays "other" — by design categorization can never fail a save.
    }
  }
}

async function askGemini(
  apiKey: string,
  title: string,
  note: string | null,
): Promise<CategoryKey | null> {
  const prompt =
    `Categorize this shared group expense into exactly one category.\n` +
    `Categories: ${CATEGORIES.join(", ")}\n` +
    `Expense title: ${title}\n` +
    (note ? `Note: ${note}\n` : "") +
    `Reply with only the category word.`;

  for (const model of modelChain()) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0, maxOutputTokens: 500 },
          }),
          signal: AbortSignal.timeout(8000),
        },
      );
      if (response.status === 429 || response.status >= 500) continue; // next model
      if (!response.ok) return null;
      const data = (await response.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = data.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? "")
        .join("")
        .trim()
        .toLowerCase();
      const match = CATEGORIES.find((c) => text?.includes(c));
      if (match) return match;
      return null;
    } catch {
      continue; // timeout/network -> next model
    }
  }
  return null;
}
