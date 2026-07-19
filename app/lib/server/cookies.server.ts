import { isLocale, pickLocaleFromHeader, type Locale } from "../i18n";

const YEAR = 60 * 60 * 24 * 365;

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function getLocale(request: Request): Locale {
  const fromCookie = readCookie(request, "sumup_locale");
  if (isLocale(fromCookie)) return fromCookie;
  return pickLocaleFromHeader(request.headers.get("Accept-Language"));
}

export function localeCookie(locale: Locale): string {
  return `sumup_locale=${locale}; Path=/; Max-Age=${YEAR}; SameSite=Lax`;
}

/** memberId this device claims within a group; empty string = "just viewing". */
export function getClaimedMember(request: Request, groupId: string): string | null {
  return readCookie(request, `sumup_me_${groupId}`);
}

export function claimedMemberCookie(groupId: string, memberId: string): string {
  return `sumup_me_${groupId}=${encodeURIComponent(memberId)}; Path=/; Max-Age=${YEAR}; SameSite=Lax`;
}
