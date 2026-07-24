import { Link, Outlet, useOutletContext, useRevalidator } from "react-router";
import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

import type { Route } from "./+types/group";
import { loadSnapshot } from "../lib/server/queries.server";
import { getClaimedMember } from "../lib/server/cookies.server";
import { getSnapshot, rememberDeviceGroup, saveSnapshot } from "../lib/client/idb";
import { overlayOps } from "../lib/client/overlay";
import { flushOutbox, onOutboxChange, pendingOps } from "../lib/client/outbox";
import { readClaim, writeClaim } from "../lib/client/claim";
import { warmRouteChunks } from "../lib/client/warm";
import { accentStrong } from "../lib/accent";
import { useSupabaseConfig, useT } from "../root";
import type { GroupSnapshot } from "../lib/types";

export async function loader({ params, request }: Route.LoaderArgs) {
  const snapshot = await loadSnapshot(params.slug);
  if (!snapshot) throw new Response("Not found", { status: 404 });
  return {
    snapshot,
    me: getClaimedMember(request, snapshot.group.id),
    offline: false,
    pending: 0,
    fromServer: true,
  };
}

export async function clientLoader({ serverLoader, params }: Route.ClientLoaderArgs) {
  let snapshot: GroupSnapshot | undefined;
  let me: string | null = null;
  let offline = false;
  try {
    const data = await serverLoader();
    snapshot = data.snapshot;
    me = data.me;
    await saveSnapshot(snapshot);
  } catch (error) {
    // Network down or server unreachable — serve the mirror if we have one.
    snapshot = await getSnapshot(params.slug);
    if (!snapshot) throw error;
    offline = true;
  }
  const ops = await pendingOps(params.slug);
  const overlaid = overlayOps(snapshot, ops);
  me ??= readClaim(overlaid.group.id);
  await rememberDeviceGroup({
    slug: overlaid.group.slug,
    name: overlaid.group.name,
    accentColor: overlaid.group.accentColor,
    baseCurrency: overlaid.group.baseCurrency,
    lastOpenedAt: Date.now(),
  });
  return { snapshot: overlaid, me, offline, pending: ops.length, fromServer: false };
}

export interface GroupContext {
  snapshot: GroupSnapshot;
  me: string | null;
  offline: boolean;
  pending: number;
}

export function useGroup(): GroupContext {
  return useOutletContext<GroupContext>();
}

export default function GroupLayout({ loaderData }: Route.ComponentProps) {
  const { snapshot, offline, pending, fromServer } = loaderData;
  const { t } = useT();
  const revalidator = useRevalidator();
  const supabaseConfig = useSupabaseConfig();
  const [claimed, setClaimed] = useState(loaderData.me);

  // First SSR render skipped the clientLoader — mirror it from an effect.
  useEffect(() => {
    if (!fromServer) return;
    void saveSnapshot(snapshot);
    void rememberDeviceGroup({
      slug: snapshot.group.slug,
      name: snapshot.group.name,
      accentColor: snapshot.group.accentColor,
      baseCurrency: snapshot.group.baseCurrency,
      lastOpenedAt: Date.now(),
    });
    setClaimed((current) => current ?? readClaim(snapshot.group.id));
  }, [fromServer, snapshot]);

  // Reconnect + focus + queued-write changes -> flush the outbox, refresh.
  useEffect(() => {
    const refresh = () => {
      void flushOutbox().finally(() => revalidator.revalidate());
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onVisible);
    const unsubscribe = onOutboxChange(() => revalidator.revalidate());
    refresh(); // drain anything queued from a previous (possibly offline) session
    warmRouteChunks();
    return () => {
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onVisible);
      unsubscribe();
    };
  }, [revalidator]);

  // Realtime doorbell: a contentless ping on the group channel means "reload".
  useEffect(() => {
    if (!supabaseConfig) return;
    const client = createClient(supabaseConfig.url, supabaseConfig.key, {
      auth: { persistSession: false },
    });
    const channel = client
      .channel(`group:${snapshot.group.slug}`)
      .on("broadcast", { event: "changed" }, () => revalidator.revalidate())
      .subscribe();
    return () => {
      void channel.unsubscribe();
      void client.removeAllChannels();
    };
  }, [supabaseConfig, snapshot.group.slug, revalidator]);

  const context: GroupContext = { snapshot, me: claimed, offline, pending };
  const needsClaim = claimed === null && snapshot.members.length > 0;

  return (
    <div
      className="mx-auto min-h-dvh max-w-lg"
      style={{ "--accent": accentStrong(snapshot.group.accentColor) } as React.CSSProperties}
    >
      {offline && (
        <div className="animate-slide-up bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {t.offlineBanner}
        </div>
      )}
      {!offline && pending > 0 && (
        <div className="animate-slide-up flex items-center justify-center gap-2 bg-[var(--surface-sunken)] px-4 py-1.5 text-center text-xs font-medium text-[var(--text-muted)]">
          <span className="size-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
          {t.syncPending(pending)}
        </div>
      )}
      {needsClaim ? (
        <ClaimScreen
          snapshot={snapshot}
          onClaim={(memberId) => {
            writeClaim(snapshot.group.id, memberId);
            setClaimed(memberId);
          }}
        />
      ) : (
        <Outlet context={context} />
      )}
    </div>
  );
}

function ClaimScreen({
  snapshot,
  onClaim,
}: {
  snapshot: GroupSnapshot;
  onClaim: (memberId: string) => void;
}) {
  const { t } = useT();
  return (
    <main className="animate-rise px-4 py-10">
      <h1 className="text-2xl font-bold tracking-tight">{snapshot.group.name}</h1>
      <h2 className="mt-7 text-lg font-semibold">{t.whoAreYou}</h2>
      <p className="mt-1 text-sm text-[var(--text-muted)]">{t.whoAreYouHint}</p>
      <div className="stagger mt-6 flex flex-col gap-2">
        {snapshot.members.map((member, index) => (
          <button
            key={member.id}
            onClick={() => onClaim(member.id)}
            style={{ "--i": index } as React.CSSProperties}
            className="card pressable px-4 py-3.5 text-left text-base font-medium"
          >
            {member.name}
          </button>
        ))}
        <button
          onClick={() => onClaim("")}
          className="btn btn-ghost mt-2 self-start -ml-3"
        >
          {t.notInList}
        </button>
      </div>
    </main>
  );
}

export function ErrorBoundary() {
  const { t } = useT();
  return (
    <main className="animate-rise mx-auto max-w-md px-4 pt-16 text-center">
      <h1 className="text-xl font-bold">{t.notFound}</h1>
      <p className="mt-2 text-[var(--text-muted)]">{t.groupNotFound}</p>
      <Link to="/" className="btn btn-outline mt-6">
        {t.backHome}
      </Link>
    </main>
  );
}
