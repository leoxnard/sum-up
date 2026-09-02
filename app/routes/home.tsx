import { Link, Outlet, useLocation, useNavigate } from "react-router";
import { useEffect, useState } from "react";

import type { Route } from "./+types/home";
import { useT } from "../root";
import {
  forgetDeviceGroup,
  getSnapshot,
  listDeviceGroups,
  listOutbox,
  type DeviceGroup,
} from "../lib/client/idb";
import { readClaim } from "../lib/client/claim";
import { computeBalances } from "../lib/balances";
import { formatCents } from "../lib/money";
import { accentVars } from "../lib/accent";
import { IconPlus } from "../components/icons";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Sum Up" },
    { name: "description", content: "Split group expenses. No accounts, just a link." },
  ];
}

/** A remembered group plus, when the mirror can answer for it, your balance. */
type Listed = DeviceGroup & { balanceCents: number | null };

export default function Home() {
  const { t, intl } = useT();
  const navigate = useNavigate();
  // The group list is device-local (IndexedDB) — there is no server-side "my
  // groups" because there are no accounts. Renders after hydration.
  const [groups, setGroups] = useState<Listed[] | null>(null);
  const [joinValue, setJoinValue] = useState("");
  const [joinError, setJoinError] = useState(false);
  const [storageBroken, setStorageBroken] = useState(false);

  // A sheet is open whenever the child route is; the list behind recedes.
  const sheetOpen = useLocation().pathname !== "/";

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let local: DeviceGroup[];
      try {
        local = await listDeviceGroups();
      } catch {
        // The screen must never be left on skeletons. If the local mirror is
        // unreadable the list is genuinely unknown, not empty — say so, and
        // keep "New group" and "Join" usable, which is the way back out.
        if (!cancelled) {
          setGroups([]);
          setStorageBroken(true);
        }
        return;
      }
      if (cancelled) return;
      // Paint the list before enriching it: the balances come from a second
      // round of mirror reads, and a slow or failing one must not hold the
      // whole screen hostage.
      setGroups(local.map((group) => ({ ...group, balanceCents: null })));
      const enriched = await withBalances(local);
      if (!cancelled) setGroups(enriched);

      // Then, if we can reach the server, drop the ones that are gone —
      // deleted here, or by anyone else holding the link. Groups with queued
      // writes are skipped: an offline-created group doesn't exist yet.
      if (!navigator.onLine || local.length === 0) return;
      try {
        const queued = new Set((await listOutbox()).map((item) => item.op.slug));
        const check = local.map((g) => g.slug).filter((slug) => !queued.has(slug));
        if (check.length === 0 || cancelled) return;
        const response = await fetch(`/api/groups?slugs=${check.join(",")}`);
        if (!response.ok) return;
        const { alive } = (await response.json()) as { alive: string[] };
        const gone = check.filter((slug) => !alive.includes(slug));
        if (gone.length === 0 || cancelled) return;
        for (const slug of gone) await forgetDeviceGroup(slug);
        if (!cancelled) setGroups(await withBalances(await listDeviceGroups()));
      } catch {
        // Offline or server down — the list stays exactly as it is.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function join() {
    const match = /(?:\/g\/)?([A-Za-z0-9_-]{12,64})\s*$/.exec(joinValue.trim());
    if (!match) {
      setJoinError(true);
      return;
    }
    void navigate(`/g/${match[1]}`);
  }

  return (
    <>
      <div className="stack" data-recessed={sheetOpen}>
        <main className="mx-auto flex min-h-dvh max-w-lg flex-col px-5 pb-16 pt-[max(2.5rem,env(safe-area-inset-top))]">
          <header className="animate-rise flex items-end justify-between gap-3">
            <div>
              <p className="text-[0.78125rem] font-semibold text-[var(--text-3)]">
                {t.appName}
              </p>
              <h1 className="mt-0.5 text-[2.25rem] font-extrabold leading-[1.05] tracking-[-0.03em]">
                {t.yourGroups}
              </h1>
            </div>
            <Link
              to="/new"
              aria-label={t.createGroup}
              className="glass-btn glass-btn-accent mb-1"
            >
              <IconPlus className="size-[1.125rem]" />
            </Link>
          </header>

          <section className="mt-7">
            <div className="flex flex-col gap-3">
              {groups === null ? (
                <>
                  <div className="skeleton h-[4.5rem] rounded-[var(--radius-card)]" />
                  <div className="skeleton h-[4.5rem] rounded-[var(--radius-card)] opacity-60" />
                </>
              ) : storageBroken ? (
                <p className="banner-warn animate-pop">{t.storageUnavailable}</p>
              ) : groups.length === 0 ? (
                <p className="glass animate-pop px-4 py-7 text-center text-sm text-[var(--text-2)]">
                  {t.noGroupsYet}
                </p>
              ) : (
                <div className="stagger flex flex-col gap-3">
                  {groups.map((group, index) => (
                    <Link
                      key={group.slug}
                      to={`/g/${group.slug}`}
                      style={
                        {
                          "--i": index,
                          ...accentVars(group.accentColor),
                        } as React.CSSProperties
                      }
                      className="glass pressable flex items-center gap-3.5 px-[1.125rem] py-[1.0625rem]"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[1.0625rem] font-bold tracking-[-0.01em]">
                          {group.name}
                        </span>
                        <span className="mt-0.5 block text-[0.78125rem] text-[var(--text-2)]">
                          {group.baseCurrency}
                        </span>
                      </span>
                      {group.balanceCents !== null && (
                        <span
                          className="num shrink-0 text-[0.9375rem]"
                          style={{
                            color:
                              group.balanceCents > 0
                                ? "var(--accent)"
                                : group.balanceCents < 0
                                  ? "var(--neg)"
                                  : "var(--text-2)",
                          }}
                        >
                          {formatCents(group.balanceCents, group.baseCurrency, intl)}
                        </span>
                      )}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="mt-9">
            <h2 className="section-label">{t.joinGroup}</h2>
            <div className="mt-2.5 flex gap-2">
              <input
                value={joinValue}
                onChange={(e) => {
                  setJoinValue(e.target.value);
                  setJoinError(false);
                }}
                onKeyDown={(e) => e.key === "Enter" && join()}
                placeholder={t.joinByCode}
                className="input"
              />
              <button onClick={join} className="btn btn-outline">
                {t.join}
              </button>
            </div>
            {joinError && (
              <p className="animate-pop mt-1.5 text-sm" style={{ color: "var(--neg)" }}>
                {t.joinInvalid}
              </p>
            )}
          </section>

          {/* mt-auto keeps the hint pinned to the bottom edge when the page is
              short, instead of floating right under the last section. */}
          <footer className="mt-auto pt-14 text-center text-xs text-[var(--text-3)]">
            {t.installHint}
            <Link to="/legal" className="mt-2 block underline">
              {t.legal}
            </Link>
          </footer>
        </main>
      </div>

      <Outlet />
    </>
  );
}

/**
 * Your standing in each group, read from the offline mirror. Groups that have
 * never been opened on this device, or where you haven't said who you are, are
 * listed without a number rather than with a misleading zero.
 */
async function withBalances(groups: DeviceGroup[]): Promise<Listed[]> {
  return Promise.all<Listed>(
    groups.map(async (group) => {
      try {
        const snapshot = await getSnapshot(group.slug);
        if (!snapshot) return { ...group, balanceCents: null };
        const me = readClaim(snapshot.group.id);
        if (!me) return { ...group, balanceCents: null };
        return { ...group, balanceCents: computeBalances(snapshot).get(me) ?? 0 };
      } catch {
        return { ...group, balanceCents: null };
      }
    }),
  );
}
