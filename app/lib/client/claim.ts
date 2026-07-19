// The device-local "which member am I?" claim. A plain cookie (not HttpOnly) so
// both the server (SSR personalization) and offline client code can read it.
const YEAR = 60 * 60 * 24 * 365;

export function readClaim(groupId: string): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === `sumup_me_${groupId}`) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function writeClaim(groupId: string, memberId: string): void {
  document.cookie = `sumup_me_${groupId}=${encodeURIComponent(memberId)}; Path=/; Max-Age=${YEAR}; SameSite=Lax`;
}
