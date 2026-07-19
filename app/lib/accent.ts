// Curated per-group accent swatches. Each has a strong tone that stays readable
// as text/fills on both light and dark backgrounds (white text on the strong
// tone passes contrast in both modes).
export const ACCENTS = {
  emerald: { strong: "#047857", soft: "#03402f" },
  teal: { strong: "#0f766e", soft: "#0c4a45" },
  sky: { strong: "#0369a1", soft: "#0a3b57" },
  indigo: { strong: "#4338ca", soft: "#2b2a6e" },
  violet: { strong: "#6d28d9", soft: "#3f2278" },
  rose: { strong: "#be123c", soft: "#671330" },
  orange: { strong: "#c2410c", soft: "#66280e" },
  amber: { strong: "#b45309", soft: "#5f300c" },
  lime: { strong: "#4d7c0f", soft: "#2c440f" },
  slate: { strong: "#475569", soft: "#2b3442" },
} as const;

export type AccentKey = keyof typeof ACCENTS;

export const ACCENT_KEYS = Object.keys(ACCENTS) as AccentKey[];

export function isAccent(value: string): value is AccentKey {
  return value in ACCENTS;
}

export function randomAccent(): AccentKey {
  return ACCENT_KEYS[Math.floor(Math.random() * ACCENT_KEYS.length)];
}

export function accentStrong(key: string): string {
  return ACCENTS[isAccent(key) ? key : "emerald"].strong;
}
