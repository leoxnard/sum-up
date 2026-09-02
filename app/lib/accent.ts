// Curated per-group accent swatches. Each key carries two tones because the app
// renders on two very different grounds: `strong` is a deep, saturated colour
// that stays legible as text on a pale glass surface, `vivid` is the iOS-26
// system tone that glows on the dark glass. Picking one per theme keeps the
// same swatch recognisable in both without either side washing out.
export const ACCENTS = {
  emerald: { strong: "#047857", vivid: "#30d158", soft: "#03402f" },
  teal: { strong: "#0f766e", vivid: "#40cbc0", soft: "#0c4a45" },
  sky: { strong: "#0369a1", vivid: "#0a84ff", soft: "#0a3b57" },
  indigo: { strong: "#4338ca", vivid: "#5e5ce6", soft: "#2b2a6e" },
  violet: { strong: "#6d28d9", vivid: "#bf5af2", soft: "#3f2278" },
  rose: { strong: "#be123c", vivid: "#ff375f", soft: "#671330" },
  orange: { strong: "#c2410c", vivid: "#ff6b22", soft: "#66280e" },
  amber: { strong: "#b45309", vivid: "#ff9f0a", soft: "#5f300c" },
  lime: { strong: "#4d7c0f", vivid: "#9ee84a", soft: "#2c440f" },
  slate: { strong: "#475569", vivid: "#98989f", soft: "#2b3442" },
} as const;

export type AccentKey = keyof typeof ACCENTS;

export const ACCENT_KEYS = Object.keys(ACCENTS) as AccentKey[];

/** Text drawn on top of a filled accent button. */
const INK = "#08120c";

export function isAccent(value: string): value is AccentKey {
  return value in ACCENTS;
}

export function randomAccent(): AccentKey {
  return ACCENT_KEYS[Math.floor(Math.random() * ACCENT_KEYS.length)];
}

function accentOf(key: string) {
  return ACCENTS[isAccent(key) ? key : "emerald"];
}

export function accentStrong(key: string): string {
  return accentOf(key).strong;
}

export function accentVivid(key: string): string {
  return accentOf(key).vivid;
}

/** WCAG relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/**
 * Ink or white on a filled accent, whichever has more contrast. The vivid tones
 * run from `#9ee84a` to `#5e5ce6`, so a single hard-coded label colour would be
 * unreadable at one end of the palette or the other.
 */
export function onAccent(hex: string): string {
  const l = luminance(hex);
  const onInk = (l + 0.05) / (luminance(INK) + 0.05);
  const onWhite = 1.05 / (l + 0.05);
  return onInk >= onWhite ? INK : "#ffffff";
}

/**
 * The CSS custom properties a group's accent drives, for an inline style. Both
 * grounds are handed over at once and app.css picks the pair that matches the
 * active colour scheme — a media query can't reach into an inline style.
 */
export function accentVars(key: string): Record<string, string> {
  const { strong, vivid } = accentOf(key);
  const inkLight = onAccent(strong);
  const inkDark = onAccent(vivid);
  const tick = (ink: string) => (ink === INK ? "var(--tick-ink)" : "var(--tick-white)");
  return {
    "--accent-light": strong,
    "--accent-dark": vivid,
    "--accent-ink-light": inkLight,
    "--accent-ink-dark": inkDark,
    "--tick-light": tick(inkLight),
    "--tick-dark": tick(inkDark),
  };
}
