import type { CategoryKey } from "./types";

export const CATEGORIES: CategoryKey[] = [
  "food",
  "groceries",
  "transport",
  "accommodation",
  "activities",
  "shopping",
  "other",
];

// DE + EN keyword lists. Matching is on word boundaries, never on raw
// substrings: a trailing "*" means "this token may continue" ("pizz*" hits
// "Pizzeria"), anything else must equal a whole token. Keywords containing a
// space or hyphen match as a consecutive phrase.
//
// The distinction is not cosmetic. Substring matching made "bar" hit
// *Barcelona*, "eis" hit *Reise* and *Preis*, "spar" hit *Sparkasse*, "rent"
// hit *Rentnerrabatt* and "dm" hit *Amsterdam* — all silently, because the
// first matching category wins and `food` is checked first.
//
// Deliberately conservative: a miss is fine (the LLM pass or the user fixes
// it); a wrong hit is annoying.
const KEYWORDS: Record<Exclude<CategoryKey, "other">, string[]> = {
  food: [
    "restaurant*", "pizz*", "burger*", "kebab*", "döner", "doner", "sushi", "ramen",
    "café*", "cafe", "coffee", "kaffee", "bäcker*", "baecker*", "bakery", "brunch",
    "breakfast", "frühstück", "lunch", "mittagessen", "dinner", "abendessen",
    "essen", "bar", "bier", "biere", "beer", "wein", "wine", "drink*", "cocktail*", "eis",
    "eisdiele", "ice cream", "imbiss", "takeaway", "lieferando", "delivery", "mcdonald*",
    "brauhaus", "biergarten", "tapas", "pasta", "trattoria", "bistro",
  ],
  groceries: [
    "rewe", "edeka", "aldi", "lidl", "netto", "penny", "kaufland", "dm",
    "rossmann", "supermarkt", "supermarket", "groceries", "einkauf*", "spar",
    "migros", "coop", "tesco", "carrefour", "mercadona", "lebensmittel",
  ],
  transport: [
    "taxi*", "uber", "bolt", "zug", "train*", "bahn", "db", "ice", "flug*",
    "flight*", "ryanair", "easyjet", "lufthansa", "bus", "tram", "metro",
    "u-bahn", "ticket*", "tanken", "fuel", "gas station", "benzin", "diesel", "maut",
    "toll", "parken", "parking", "mietwagen", "rental car", "ferry", "fähre",
    "faehre", "vignette", "öpnv", "sixt",
  ],
  accommodation: [
    "hotel*", "airbnb", "hostel*", "booking", "unterkunft", "ferienwohnung",
    "apartment*", "camping*", "campingplatz", "pension", "motel", "resort",
    "hütte", "huette", "lodge", "miete", "rent",
  ],
  activities: [
    "museum*", "kino", "cinema", "movie*", "konzert*", "concert*", "festival*",
    "eintritt", "entrance", "tour*", "stadttour", "ski", "lift", "skipass", "surf*", "kajak",
    "kayak", "climbing", "klettern", "bowling", "minigolf", "zoo", "pool",
    "schwimmbad", "therme", "spa", "sauna", "escape", "theater", "theatre",
    "match", "spiel", "game*",
  ],
  shopping: [
    "amazon", "ikea", "zara", "h&m", "uniqlo", "decathlon", "shopping",
    "kleidung", "clothes", "clothing", "schuhe", "shoes", "souvenir*",
    "geschenk*", "gift*", "apotheke", "pharmacy", "media markt", "saturn",
    "elektronik", "electronics",
  ],
};

export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Split into lowercase word tokens; punctuation and separators are dropped. */
function tokenize(normalized: string): string[] {
  return normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** True when `token` equals `pattern`, or starts with it for a "foo*" pattern. */
function tokenMatches(token: string, pattern: string): boolean {
  return pattern.endsWith("*") ? token.startsWith(pattern.slice(0, -1)) : token === pattern;
}

/** True when the keyword's tokens appear consecutively in `tokens`. */
function matchesKeyword(tokens: string[], keyword: string): boolean {
  const parts = tokenize(keyword);
  if (parts.length === 0) return false;
  for (let start = 0; start + parts.length <= tokens.length; start++) {
    // Only the final part carries a possible "*", so restore it before comparing.
    const suffixed = keyword.endsWith("*");
    let all = true;
    for (let i = 0; i < parts.length; i++) {
      const pattern = suffixed && i === parts.length - 1 ? `${parts[i]}*` : parts[i];
      if (!tokenMatches(tokens[start + i], pattern)) {
        all = false;
        break;
      }
    }
    if (all) return true;
  }
  return false;
}

/** Synchronous keyword pass. Null = no confident match (candidate for the LLM pass). */
export function categorizeByKeywords(title: string): Exclude<CategoryKey, "other"> | null {
  const tokens = tokenize(normalizeTitle(title));
  if (tokens.length === 0) return null;
  for (const [category, words] of Object.entries(KEYWORDS) as [
    Exclude<CategoryKey, "other">,
    string[],
  ][]) {
    for (const word of words) {
      if (matchesKeyword(tokens, word)) return category;
    }
  }
  return null;
}
