// The device-local "which member am I?" claim. A plain cookie (not HttpOnly) so
// both the server (SSR personalization) and offline client code can read it.
const YEAR = 60 * 60 * 24 * 365;

/**
 * Write a first-party cookie with the app's standard attributes. `Secure` is
 * unconditional: browsers treat http://localhost as a secure context, so it
 * costs nothing in dev and keeps the group slug's companion cookies off plain
 * HTTP everywhere else.
 */
export function writeCookie(name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${YEAR}; SameSite=Lax; Secure`;
}

export function readClaim(groupId: string): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === `sumup_me_${groupId}`) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function writeClaim(groupId: string, memberId: string): void {
  writeCookie(`sumup_me_${groupId}`, memberId);
}
