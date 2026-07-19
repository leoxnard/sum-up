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

export const CATEGORY_EMOJI: Record<CategoryKey, string> = {
  food: "🍽️",
  groceries: "🛒",
  transport: "🚕",
  accommodation: "🏠",
  activities: "🎟️",
  shopping: "🛍️",
  other: "📎",
};

// DE + EN keyword lists. Matching is on normalized whole words / prefixes, so
// "Pizzeria Luigi" hits "pizz". Deliberately conservative: a miss is fine (the
// LLM pass or the user fixes it); a wrong hit is annoying.
const KEYWORDS: Record<Exclude<CategoryKey, "other">, string[]> = {
  food: [
    "restaurant", "pizz", "burger", "kebab", "döner", "doner", "sushi", "ramen",
    "café", "cafe", "coffee", "kaffee", "bäcker", "baecker", "bakery", "brunch",
    "breakfast", "frühstück", "lunch", "mittagessen", "dinner", "abendessen",
    "essen", "bar", "bier", "beer", "wein", "wine", "drinks", "cocktail", "eis",
    "ice cream", "imbiss", "takeaway", "lieferando", "delivery", "mcdonald",
    "brauhaus", "biergarten", "tapas", "pasta",
  ],
  groceries: [
    "rewe", "edeka", "aldi", "lidl", "netto", "penny", "kaufland", "dm",
    "rossmann", "supermarkt", "supermarket", "groceries", "einkauf", "spar",
    "migros", "coop", "tesco", "carrefour", "mercadona", "lebensmittel",
  ],
  transport: [
    "taxi", "uber", "bolt", "zug", "train", "bahn", "db", "ice", "flug",
    "flight", "ryanair", "easyjet", "lufthansa", "bus", "tram", "metro",
    "u-bahn", "ticket", "tanken", "fuel", "gas station", "benzin", "diesel", "maut",
    "toll", "parken", "parking", "mietwagen", "rental car", "ferry", "fähre",
    "faehre", "vignette", "öpnv", "sixt",
  ],
  accommodation: [
    "hotel", "airbnb", "hostel", "booking", "unterkunft", "ferienwohnung",
    "apartment", "camping", "campingplatz", "pension", "motel", "resort",
    "hütte", "huette", "lodge", "miete", "rent",
  ],
  activities: [
    "museum", "kino", "cinema", "movie", "konzert", "concert", "festival",
    "eintritt", "entrance", "tour", "ski", "lift", "skipass", "surf", "kajak",
    "kayak", "climbing", "klettern", "bowling", "minigolf", "zoo", "pool",
    "schwimmbad", "therme", "spa", "sauna", "escape", "theater", "theatre",
    "match", "spiel", "game",
  ],
  shopping: [
    "amazon", "ikea", "zara", "h&m", "uniqlo", "decathlon", "shopping",
    "kleidung", "clothes", "clothing", "schuhe", "shoes", "souvenir",
    "geschenk", "gift", "apotheke", "pharmacy", "media markt", "saturn",
    "elektronik", "electronics",
  ],
};

export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Synchronous keyword pass. Null = no confident match (candidate for the LLM pass). */
export function categorizeByKeywords(title: string): Exclude<CategoryKey, "other"> | null {
  const normalized = normalizeTitle(title);
  if (!normalized) return null;
  for (const [category, words] of Object.entries(KEYWORDS) as [
    Exclude<CategoryKey, "other">,
    string[],
  ][]) {
    for (const word of words) {
      if (normalized.includes(word)) return category;
    }
  }
  return null;
}
