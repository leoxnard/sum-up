import { modelChain } from "./gemini.server";
import {
  extractionSchema,
  parseExtraction,
  type Extraction,
  type ExtractMember,
} from "../extract";

export type ExtractionResult =
  | ({ ok: true } & Extraction)
  | { ok: false; error: "no_key" | "unavailable" | "unreadable" };

export interface ExtractionRequest {
  /** the whole instruction, built by the image or voice caller */
  prompt: string;
  /** `data:<mime>;base64,<payload>` — an image or an audio recording */
  dataUrl: string;
  /** which media types the caller accepts, guarding against a mislabelled blob */
  accept: "image" | "audio";
  baseCurrency: string;
  today: string;
  members?: ExtractMember[];
  /** ask for payer / participants / note / transcript — only speech can fill these */
  withPeople?: boolean;
}

/**
 * Run one extraction against the model chain and hand back sanitized rows.
 *
 * Shared by the image and the voice importer: both send a prompt plus one
 * inline media part and get the same JSON shape back, so the fallback walk, the
 * time budget and the re-validation live here exactly once.
 */
export async function runExtraction(request: ExtractionRequest): Promise<ExtractionResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, error: "no_key" };

  const pattern =
    request.accept === "image"
      ? /^data:(image\/[a-z0-9+.-]+);base64,(.+)$/s
      : /^data:(audio\/[a-z0-9+.-]+);base64,(.+)$/s;
  const match = pattern.exec(request.dataUrl);
  if (!match) return { ok: false, error: "unreadable" };
  const [, mimeType, base64] = match;

  const withPeople = request.withPeople ?? false;
  let sawResponse = false;
  // Media calls are slow enough that walking the whole model chain can outlive
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
                parts: [
                  { text: request.prompt },
                  { inlineData: { mimeType, data: base64 } },
                ],
              },
            ],
            generationConfig: {
              temperature: 0,
              maxOutputTokens: 4096,
              responseMimeType: "application/json",
              responseSchema: extractionSchema(withPeople),
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
      const extraction = parseExtraction(text, {
        baseCurrency: request.baseCurrency,
        today: request.today,
        members: request.members,
      });
      if (extraction === null) continue; // unparseable — try the next model
      return { ok: true, ...extraction };
    } catch {
      continue; // timeout/network -> next model
    }
  }
  return { ok: false, error: sawResponse ? "unreadable" : "unavailable" };
}
