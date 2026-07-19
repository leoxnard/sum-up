import type { Route } from "./+types/api.sync";
import { applySyncOps } from "../lib/server/sync.server";
import { ringDoorbell } from "../lib/server/doorbell.server";
import { categorizeWithGemini } from "../lib/server/gemini.server";
import { runInBackground } from "../lib/server/background.server";
import type { SyncOp } from "../lib/types";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  let ops: SyncOp[];
  try {
    const body = (await request.json()) as { ops?: SyncOp[] };
    ops = body.ops ?? [];
    if (!Array.isArray(ops) || ops.length > 200) throw new Error("bad_ops");
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const outcome = await applySyncOps(ops);

  runInBackground(async () => {
    await ringDoorbell(outcome.changedSlugs);
    await categorizeWithGemini(outcome.llmCandidates);
  });

  return Response.json(outcome.result);
}
