import type { Route } from "./+types/group.photo";
import { sql } from "../lib/server/db.server";

// Receipt photos, gated by slug knowledge like everything else in a group.
export async function loader({ params }: Route.LoaderArgs) {
  const rows = await sql<{ content_type: string; data: Uint8Array }[]>`
    select p.content_type, p.data
    from photos p
    join groups g on g.id = p.group_id
    where p.id = ${params.photoId} and g.slug = ${params.slug} and g.deleted_at is null
  `;
  if (rows.length === 0) throw new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(rows[0].data), {
    headers: {
      "Content-Type": rows[0].content_type,
      // Photo ids are immutable — cache hard.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
