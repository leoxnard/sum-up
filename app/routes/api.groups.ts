import type { Route } from "./+types/api.groups";
import { filterLiveSlugs } from "../lib/server/queries.server";

const SLUG = /^[A-Za-z0-9_-]{12,64}$/;

// Answers "which of these groups still exist?" for the start screen, so a group
// deleted anywhere stops being listed on this device.
export async function loader({ request }: Route.LoaderArgs) {
  const raw = new URL(request.url).searchParams.get("slugs") ?? "";
  const slugs = [...new Set(raw.split(",").filter((slug) => SLUG.test(slug)))].slice(0, 60);
  return Response.json({ alive: await filterLiveSlugs(slugs) });
}
