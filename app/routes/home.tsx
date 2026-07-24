import { Link, useNavigate } from "react-router";
import { useEffect, useState } from "react";

import type { Route } from "./+types/home";
import { useT } from "../root";
import { listDeviceGroups, type DeviceGroup } from "../lib/client/idb";
import { accentStrong } from "../lib/accent";
import { IconArrowRight, IconPlus } from "../components/icons";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Sum Up" },
    { name: "description", content: "Split group expenses. No accounts, just a link." },
  ];
}

export default function Home() {
  const { t } = useT();
  const navigate = useNavigate();
  // The group list is device-local (IndexedDB) — there is no server-side "my
  // groups" because there are no accounts. Renders after hydration.
  const [groups, setGroups] = useState<DeviceGroup[] | null>(null);
  const [joinValue, setJoinValue] = useState("");
  const [joinError, setJoinError] = useState(false);

  useEffect(() => {
    void listDeviceGroups().then(setGroups);
  }, []);

  function join() {
    const match = /(?:\/g\/)?([A-Za-z0-9_-]{12,64})\s*$/.exec(joinValue.trim());
    if (!match) {
      setJoinError(true);
      return;
    }
    navigate(`/g/${match[1]}`);
  }

  return (
    <main className="mx-auto min-h-dvh max-w-lg px-4 pb-16 pt-12">
      <header className="animate-rise">
        <h1 className="text-4xl font-extrabold tracking-tight">
          Sum <span className="text-[var(--accent)]">Up</span>
        </h1>
        <p className="mt-1.5 text-[var(--text-muted)]">{t.homeTagline}</p>
      </header>

      <section className="mt-9">
        <h2 className="section-label">{t.yourGroups}</h2>
        <div className="mt-2.5 flex flex-col gap-2">
          {groups === null ? (
            <>
              <div className="skeleton h-[4.25rem] rounded-[var(--radius-card)]" />
              <div className="skeleton h-[4.25rem] rounded-[var(--radius-card)] opacity-60" />
            </>
          ) : groups.length === 0 ? (
            <p className="card animate-pop px-4 py-6 text-center text-sm text-[var(--text-muted)]">
              {t.noGroupsYet}
            </p>
          ) : (
            <div className="stagger flex flex-col gap-2">
              {groups.map((group, index) => (
                <Link
                  key={group.slug}
                  to={`/g/${group.slug}`}
                  style={
                    {
                      "--i": index,
                      "--group-accent": accentStrong(group.accentColor),
                    } as React.CSSProperties
                  }
                  className="card pressable group-card group flex items-center gap-3.5 px-4 py-4"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{group.name}</span>
                    <span className="block text-xs text-[var(--text-muted)]">
                      {group.baseCurrency}
                    </span>
                  </span>
                  <IconArrowRight className="size-4 shrink-0 text-[var(--text-muted)] transition-transform duration-200 group-hover:translate-x-0.5" />
                </Link>
              ))}
            </div>
          )}
        </div>
        <Link to="/new" className="btn btn-primary btn-lg mt-4 w-full">
          <IconPlus className="size-[1.1em]" />
          {t.createGroup}
        </Link>
      </section>

      <section className="mt-10">
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
          <p className="animate-pop mt-1.5 text-sm text-rose-600">{t.joinInvalid}</p>
        )}
      </section>

      <p className="mt-14 text-center text-xs text-[var(--text-muted)]">{t.installHint}</p>
    </main>
  );
}
