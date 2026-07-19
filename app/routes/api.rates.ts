import type { Route } from "./+types/api.rates";
import { isCurrency } from "../lib/currencies";

// Proxy to frankfurter.dev (ECB daily reference rates) so the client only ever
// talks to our own origin. The rate is a prefill — users can always override.
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!isCurrency(from) || !isCurrency(to)) {
    return Response.json({ error: "bad_currency" }, { status: 400 });
  }
  if (from === to) return Response.json({ rate: 1 });
  try {
    const response = await fetch(
      `https://api.frankfurter.dev/v1/latest?base=${from}&symbols=${to}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!response.ok) throw new Error(`upstream ${response.status}`);
    const data = (await response.json()) as { rates: Record<string, number> };
    const rate = data.rates[to];
    if (typeof rate !== "number") throw new Error("missing rate");
    return Response.json(
      { rate },
      { headers: { "Cache-Control": "public, max-age=3600" } },
    );
  } catch {
    return Response.json({ error: "unavailable" }, { status: 502 });
  }
}
