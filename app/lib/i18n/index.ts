import { en, type Dictionary } from "./en";
import { de } from "./de";
import type { CategoryKey } from "../types";

// Adding a locale = add a dictionary file, extend this map and LOCALES.
export const DICTIONARIES = { en, de } satisfies Record<string, Dictionary>;

export type Locale = keyof typeof DICTIONARIES;

export const LOCALES = Object.keys(DICTIONARIES) as Locale[];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  de: "Deutsch",
};

/** BCP-47 tag handed to Intl formatters. */
export const INTL_LOCALE: Record<Locale, string> = {
  en: "en-GB",
  de: "de-DE",
};

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && value in DICTIONARIES;
}

export function dict(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}

export function pickLocaleFromHeader(acceptLanguage: string | null): Locale {
  if (!acceptLanguage) return "en";
  for (const part of acceptLanguage.split(",")) {
    const tag = part.split(";")[0].trim().toLowerCase().slice(0, 2);
    if (isLocale(tag)) return tag;
  }
  return "en";
}

export function categoryLabel(t: Dictionary, category: CategoryKey | null): string {
  switch (category) {
    case "food": return t.catFood;
    case "groceries": return t.catGroceries;
    case "transport": return t.catTransport;
    case "accommodation": return t.catAccommodation;
    case "activities": return t.catActivities;
    case "shopping": return t.catShopping;
    default: return t.catOther;
  }
}
