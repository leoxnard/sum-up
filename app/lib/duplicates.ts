// "Did I already add this?" — the one mistake that is easy to make and hard to
// notice, because a double-booked expense looks perfectly normal in the list
// and only shows up as a wrong balance at the end of the trip.
//
// The check is a hint, never a block: it scores an expense that is about to be
// added against the ones already in the group and lets the UI say how sure it
// is. Amount is the anchor (a coincidence there is rare), date and title only
// sharpen or soften the guess.

import { toBaseCents } from "./money";
import type { Entry } from "./types";

export interface DuplicateInput {
  /** the entry being edited, so it never matches itself */
  id?: string | null;
  title: string;
  /** amount in the group's base currency cents */
  amountBaseCents: number;
  /** ISO date yyyy-mm-dd */
  date: string;
}

export interface DuplicateMatch {
  entry: Entry;
  /** 0..1, higher = more likely the same expense */
  score: number;
  /** "likely" is worth a loud warning, "possible" a quiet one */
  level: "likely" | "possible";
  /** whole days between the two dates */
  dayDiff: number;
  /** the base amounts are cent-identical, not just close */
  sameAmount: boolean;
}

/** Below this nothing is shown at all — the noise would train people to ignore it. */
const POSSIBLE = 0.55;
const LIKELY = 0.8;

/** Beyond two weeks apart, the same amount is a coincidence more often than not. */
const MAX_DAY_DIFF = 14;

const DAY = 86_400_000;

/** Lowercase, unaccented, punctuation-free — "Café Löwe!" and "cafe lowe" match. */
export function normalizeTitle(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Dice coefficient over character bigrams: forgiving about word order, typos
 * and the extra noise banking apps add ("REWE SAGT DANKE" vs "Rewe"), while a
 * genuinely different title still scores near zero.
 */
export function titleSimilarity(a: string, b: string): number {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  // One title being contained in the other is the common "same shop, longer
  // receipt text" case — bigrams alone would undersell it.
  if (x.includes(y) || y.includes(x)) return 0.85;

  const bigrams = (s: string) => {
    const map = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const gram = s.slice(i, i + 2);
      map.set(gram, (map.get(gram) ?? 0) + 1);
    }
    return map;
  };
  const left = bigrams(x);
  const right = bigrams(y);
  let shared = 0;
  for (const [gram, count] of left) shared += Math.min(count, right.get(gram) ?? 0);
  const total = x.length - 1 + (y.length - 1);
  return total > 0 ? (2 * shared) / total : 0;
}

/** Whole days between two ISO dates, absolute. */
function dayDistance(a: string, b: string): number {
  const left = Date.parse(`${a}T12:00:00Z`);
  const right = Date.parse(`${b}T12:00:00Z`);
  if (Number.isNaN(left) || Number.isNaN(right)) return Number.POSITIVE_INFINITY;
  return Math.round(Math.abs(left - right) / DAY);
}

function dateScore(dayDiff: number): number {
  if (dayDiff === 0) return 1;
  if (dayDiff <= 2) return 0.75;
  if (dayDiff <= 7) return 0.45;
  if (dayDiff <= MAX_DAY_DIFF) return 0.2;
  return 0;
}

/**
 * How close two base-cent amounts have to be to count as "the same amount".
 * Not exactly zero: the same expense entered twice can carry two different
 * exchange rates, which moves the converted amount by a fraction of a percent.
 */
function amountScore(a: number, b: number): number | null {
  const delta = Math.abs(a - b);
  if (delta === 0) return 1;
  const tolerance = Math.max(2, Math.round(Math.min(a, b) * 0.005));
  return delta <= tolerance ? 0.75 : null;
}

/**
 * Existing expenses that look like `candidate`, strongest first. Payments are
 * ignored — they are settlements, not spending, and a repeated transfer between
 * the same two people is a normal thing to record twice.
 */
export function findDuplicates(
  candidate: DuplicateInput,
  entries: Entry[],
  limit = 3,
): DuplicateMatch[] {
  if (!Number.isFinite(candidate.amountBaseCents) || candidate.amountBaseCents <= 0) return [];

  const matches: DuplicateMatch[] = [];
  for (const entry of entries) {
    if (entry.kind !== "expense") continue;
    if (candidate.id && entry.id === candidate.id) continue;

    const amount = amountScore(
      candidate.amountBaseCents,
      toBaseCents(entry.amountCents, entry.exchangeRate),
    );
    if (amount === null) continue;

    const dayDiff = dayDistance(candidate.date, entry.expenseDate);
    const date = dateScore(dayDiff);
    if (date === 0) continue;

    const title = titleSimilarity(candidate.title, entry.title ?? "");
    const score = 0.45 * amount + 0.3 * date + 0.25 * title;
    if (score < POSSIBLE) continue;

    matches.push({
      entry,
      score,
      level: score >= LIKELY ? "likely" : "possible",
      dayDiff,
      sameAmount: amount === 1,
    });
  }

  return matches.sort((a, b) => b.score - a.score || a.dayDiff - b.dayDiff).slice(0, limit);
}
