// Realtime "doorbell": after a successful write we broadcast a contentless ping
// on the group's channel; clients revalidate their loaders in response. Uses the
// REST broadcast endpoint so serverless functions don't hold WebSockets.

export function doorbellConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { url, key };
}

export async function ringDoorbell(slugs: Iterable<string>): Promise<void> {
  const config = doorbellConfig();
  if (!config) return;
  const messages = [...slugs].map((slug) => ({
    topic: `group:${slug}`,
    event: "changed",
    payload: {},
  }));
  if (messages.length === 0) return;
  try {
    await fetch(`${config.url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
      },
      body: JSON.stringify({ messages }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // The doorbell is best-effort; clients also revalidate on focus/reconnect.
  }
}
