import { Link, useNavigate } from "react-router";
import { useEffect, useState } from "react";

import type { Route } from "./+types/home";
import { useT } from "../root";
import { listDeviceGroups, type DeviceGroup } from "../lib/client/idb";
import { accentStrong } from "../lib/accent";

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
    <main className="mx-auto min-h-dvh max-w-lg px-4 pb-16 pt-10">
      <h1 className="text-3xl font-extrabold tracking-tight">
        Sum <span className="text-[var(--accent)]">Up</span>
      </h1>
      <p className="mt-1 text-neutral-500">{t.homeTagline}</p>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          {t.yourGroups}
        </h2>
        <div className="mt-2 flex flex-col gap-2">
          {groups === null ? null : groups.length === 0 ? (
            <p className="text-sm text-neutral-500">{t.noGroupsYet}</p>
          ) : (
            groups.map((group) => (
              <Link
                key={group.slug}
                to={`/g/${group.slug}`}
                className="flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white px-4 py-3.5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
              >
                <span
                  className="size-3.5 shrink-0 rounded-full"
                  style={{ backgroundColor: accentStrong(group.accentColor) }}
                />
                <span className="min-w-0 flex-1 truncate font-semibold">{group.name}</span>
                <span className="text-xs text-neutral-400">{group.baseCurrency}</span>
              </Link>
            ))
          )}
        </div>
        <Link
          to="/new"
          className="mt-4 block rounded-2xl bg-[var(--accent)] px-4 py-3.5 text-center font-semibold text-white shadow-lg"
        >
          + {t.createGroup}
        </Link>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          {t.joinGroup}
        </h2>
        <div className="mt-2 flex gap-2">
          <input
            value={joinValue}
            onChange={(e) => {
              setJoinValue(e.target.value);
              setJoinError(false);
            }}
            onKeyDown={(e) => e.key === "Enter" && join()}
            placeholder={t.joinByCode}
            className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 dark:border-neutral-700 dark:bg-neutral-900"
          />
          <button
            onClick={join}
            className="rounded-xl border border-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent)]"
          >
            {t.join}
          </button>
        </div>
        {joinError && <p className="mt-1 text-sm text-rose-600">{t.joinInvalid}</p>}
      </section>

      <p className="mt-14 text-center text-xs text-neutral-400">{t.installHint}</p>
    </main>
  );
}
