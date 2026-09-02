import {
  isRouteErrorResponse,
  Link,
  NavLink,
  Outlet,
  useLocation,
  useOutletContext,
  useParams,
  useRevalidator,
  useRouteError,
} from "react-router";
import type { ShouldRevalidateFunctionArgs } from "react-router";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

import type { Route } from "./+types/group";
import { loadSnapshot } from "../lib/server/queries.server";
import { getClaimedMember } from "../lib/server/cookies.server";
import {
  forgetDeviceGroup,
  getSnapshot,
  rememberDeviceGroup,
  saveSnapshot,
} from "../lib/client/idb";
import { overlayOps } from "../lib/client/overlay";
import { flushOutbox, onOutboxChange, pendingOps } from "../lib/client/outbox";
import { readClaim, writeClaim } from "../lib/client/claim";
import { warmRouteChunks } from "../lib/client/warm";
import { accentVars } from "../lib/accent";
import { useSupabaseConfig, useT } from "../root";
import {
  IconAlert,
  IconArrowLeft,
  IconBars,
  IconList,
  IconPie,
  IconPlus,
  IconSliders,
} from "../components/icons";
import type { GroupSnapshot } from "../lib/types";
import type { Dictionary } from "../lib/i18n/en";

// A shared group link is a bearer credential — it must never end up in an index.
export const meta: Route.MetaFunction = () => [
  { name: "robots", content: "noindex, nofollow" },
];

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
  const ops = await pendingOps(params.slug);
  // A queued delete means the group is gone from this device's point of view,
  // even while the op is still waiting for the network.
  if (ops.some((op) => op.op === "delete_group")) {
    await forgetDeviceGroup(params.slug);
    throw new Response("Not found", { status: 404 });
  }

  let snapshot: GroupSnapshot | undefined;
  let me: string | null = null;
  let offline = false;
  try {
    const data = await serverLoader();
    snapshot = data.snapshot;
    me = data.me;
    await saveSnapshot(snapshot);
  } catch (error) {
    // A 404 is an answer, not an outage: the group was deleted (possibly by
    // someone else) or the link is wrong. Drop the local copy instead of
    // serving a mirror of something that no longer exists.
    if (isRouteErrorResponse(error) || error instanceof Response) {
      if (error.status === 404) {
        await forgetDeviceGroup(params.slug);
        throw error;
      }
    }
    // Network down or server unreachable — serve the mirror if we have one.
    snapshot = await getSnapshot(params.slug);
    if (!snapshot) throw error;
    offline = true;
  }
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

/**
 * A tab switch is a navigation inside the same group, and a group's data cannot
 * change because you looked at a different tab. Without this, React Router's
 * single fetch reloads the group (and root) loader on every tab change — a
 * network round trip standing between the tap and the new screen, in an app
 * whose whole point is working offline.
 *
 * Everything that *can* change the data revalidates explicitly: the outbox
 * notifies on every queued and flushed write, the doorbell fires on remote
 * changes, and focus/reconnect refresh. Those keep the same URL, which is what
 * the first branch lets through.
 */
export function shouldRevalidate({
  currentUrl,
  nextUrl,
  currentParams,
  nextParams,
  formMethod,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if (currentUrl.pathname === nextUrl.pathname) return defaultShouldRevalidate;
  if (formMethod && formMethod !== "GET") return true;
  return currentParams.slug !== nextParams.slug;
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
  // Take the function, not the hook's object. `useRevalidator()` memoizes on
  // its own revalidation state, so the object identity changes the moment a
  // revalidation starts — an effect that depends on it tears down and re-runs
  // mid-flight, kicks off another revalidation, and never stops. That loop
  // re-fetched the group on repeat and re-warmed every route chunk with it,
  // which is what made the whole screen drop clicks. `revalidate` is stable.
  const { revalidate } = useRevalidator();
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
      void flushOutbox().finally(() => revalidate());
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onVisible);
    const unsubscribe = onOutboxChange(() => revalidate());
    refresh(); // drain anything queued from a previous (possibly offline) session
    warmRouteChunks();
    return () => {
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onVisible);
      unsubscribe();
    };
  }, [revalidate]);

  // Realtime doorbell: a contentless ping on the group channel means "reload".
  useEffect(() => {
    if (!supabaseConfig) return;
    const client = createClient(supabaseConfig.url, supabaseConfig.key, {
      auth: { persistSession: false },
    });
    const channel = client
      .channel(`group:${snapshot.group.slug}`)
      .on("broadcast", { event: "changed" }, () => revalidate())
      .subscribe();
    return () => {
      void channel.unsubscribe();
      void client.removeAllChannels();
    };
  }, [supabaseConfig, snapshot.group.slug, revalidate]);

  const context: GroupContext = { snapshot, me: claimed, offline, pending };
  const needsClaim = claimed === null && snapshot.members.length > 0;
  const base = `/g/${snapshot.group.slug}`;

  // The current child decides how the shell presents it: a tab sits inside the
  // scrollable page, a sheet or a push panel floats above it.
  const { pathname } = useLocation();
  const rest = pathname.slice(base.length).replace(/^\//, "");
  const kind = overlayKind(rest);
  const tabIndex = TABS.findIndex((tab) => tab.path === rest);
  const activeTab = tabIndex < 0 ? 0 : tabIndex;

  // Which way the next tab panel flies in. Remembering the last index is the
  // only way to tell "moved right along the bar" from "moved left".
  const previousTab = useRef(activeTab);
  const direction = activeTab >= previousTab.current ? 1 : -1;
  useEffect(() => {
    previousTab.current = activeTab;
  }, [activeTab]);

  return (
    <div style={accentVars(snapshot.group.accentColor) as React.CSSProperties}>
      {/* Sheets recess the whole app behind them; the scrim then dims what is
          left visible around the sheet's rounded shoulders. */}
      <div className="stack" data-recessed={kind === "sheet" || needsClaim}>
        <div className="mx-auto min-h-dvh max-w-lg">
          <header className="nav-bar" data-hidden={kind !== "tab" || needsClaim}>
            <Link to="/" aria-label={t.backHome} className="glass-btn">
              <IconArrowLeft className="size-4" />
            </Link>
            <span className="nav-title">{snapshot.group.name}</span>
            <Link
              to={`${base}/new-expense`}
              aria-label={t.addExpense}
              className="glass-btn glass-btn-accent"
            >
              <IconPlus className="size-[1.125rem]" />
            </Link>
          </header>

          <SyncBanner offline={offline} pending={pending} t={t} />

          {needsClaim ? (
            <div className="px-5 pb-32" />
          ) : (
            <div
              key={rest}
              className="animate-tab px-5 pb-40"
              data-dir={kind === "tab" ? direction : undefined}
            >
              {kind === "tab" && <Outlet context={context} />}
            </div>
          )}
        </div>
      </div>

      {kind !== "tab" && !needsClaim && <Outlet context={context} />}

      {needsClaim && (
        <ClaimSheet
          snapshot={snapshot}
          onClaim={(memberId) => {
            writeClaim(snapshot.group.id, memberId);
            setClaimed(memberId);
          }}
        />
      )}

      <TabBar base={base} index={activeTab} hidden={kind !== "tab" || needsClaim} t={t} />
    </div>
  );
}

/** The four tab-bar destinations, in bar order. */
const TABS = [
  { path: "", icon: IconPie, label: (t: Dictionary) => t.tabOverview },
  { path: "activity", icon: IconList, label: (t: Dictionary) => t.tabActivity },
  { path: "stats", icon: IconBars, label: (t: Dictionary) => t.tabStats },
  { path: "settings", icon: IconSliders, label: (t: Dictionary) => t.tabSettings },
] as const;

const SHEET_ROUTES = ["new-expense", "new-payment", "import"];

function overlayKind(rest: string): "tab" | "sheet" | "push" {
  if (SHEET_ROUTES.includes(rest)) return "sheet";
  if (rest === "settle" || rest.startsWith("entry/")) return "push";
  return "tab";
}

function TabBar({
  base,
  index,
  hidden,
  t,
}: {
  base: string;
  index: number;
  hidden: boolean;
  t: Dictionary;
}) {
  return (
    <nav
      className="tab-bar mx-auto max-w-lg"
      data-hidden={hidden}
      style={{ "--tab-count": TABS.length, "--tab-index": index } as React.CSSProperties}
    >
      <span className="tab-thumb" aria-hidden />
      {TABS.map((tab, i) => {
        const Glyph = tab.icon;
        return (
          <NavLink
            key={tab.path}
            to={tab.path ? `${base}/${tab.path}` : base}
            end={tab.path === ""}
            // The thumb already marks the tab, but only aria-current styles it,
            // and NavLink's own match would light up "Overview" on every route.
            aria-current={i === index ? "page" : undefined}
            className="tab-item"
          >
            <Glyph className="size-[1.3125rem]" width={1.9} />
            <span>{tab.label(t)}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}

/** Offline and "not synced yet" are the only states worth interrupting for. */
function SyncBanner({
  offline,
  pending,
  t,
}: {
  offline: boolean;
  pending: number;
  t: Dictionary;
}) {
  if (offline) {
    return (
      <div className="animate-slide-up px-5 pb-1">
        <p className="banner-warn">
          <IconAlert className="size-[1.0625rem] shrink-0" />
          {t.offlineBanner}
        </p>
      </div>
    );
  }
  if (pending === 0) return null;
  return (
    <div className="animate-slide-up px-5 pb-1">
      <p className="inline-flex items-center gap-[0.4375rem] rounded-full border border-[var(--glass-border)] bg-[var(--glass-raised)] px-3 py-[0.4375rem] text-[0.71875rem] font-semibold text-[var(--text-2)]">
        <span className="animate-pulse-soft size-1.5 rounded-full bg-[var(--accent)]" />
        {t.syncPending(pending)}
      </p>
    </div>
  );
}

/**
 * Picking who you are is the one thing a fresh device must do before it can
 * show a balance, so it arrives as a sheet you can't miss. It has no route of
 * its own: the choice is device-local, and a URL for it would be meaningless
 * on anyone else's phone.
 */
function ClaimSheet({
  snapshot,
  onClaim,
}: {
  snapshot: GroupSnapshot;
  onClaim: (memberId: string) => void;
}) {
  const { t } = useT();
  return (
    <>
      <div className="sheet-scrim" aria-hidden />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t.whoAreYou}
        className="sheet mx-auto max-w-lg"
      >
        <span className="sheet-grip" aria-hidden />
        <div className="sheet-body pt-4">
          <h2 className="text-2xl font-extrabold tracking-tight">{t.whoAreYou}</h2>
          <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-[var(--text-2)]">
            {t.whoAreYouHint}
          </p>
          <div className="glass glass-list mt-4">
            {snapshot.members.map((member) => (
              <button
                key={member.id}
                onClick={() => onClaim(member.id)}
                className="glass-row pressable text-[0.96875rem] font-semibold"
              >
                {member.name}
              </button>
            ))}
          </div>
          <button
            onClick={() => onClaim("")}
            className="mt-3.5 px-1 py-1 text-sm font-semibold text-[var(--text-2)]"
          >
            {t.notInList}
          </button>
        </div>
      </section>
    </>
  );
}

export function ErrorBoundary() {
  const { t } = useT();
  const error = useRouteError();
  const params = useParams();
  const gone = isRouteErrorResponse(error) && error.status === 404;

  // Reaching this screen for a 404 (a direct hit on a stale link, say) is proof
  // the group is gone — stop listing it on the start screen.
  useEffect(() => {
    if (gone && params.slug) void forgetDeviceGroup(params.slug);
  }, [gone, params.slug]);

  return (
    <main className="animate-rise mx-auto max-w-md px-4 pt-16 text-center">
      <h1 className="text-xl font-bold">{t.notFound}</h1>
      <p className="mt-2 text-[var(--text-2)]">{t.groupNotFound}</p>
      <Link to="/" className="btn btn-outline mt-6">
        {t.backHome}
      </Link>
    </main>
  );
}
