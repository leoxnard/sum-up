/**
 * The "you may have added this already" hint. Two shapes of the same warning:
 * a panel for the entry form and a single line for a scanned import row. Both
 * only ever inform — nothing is blocked, because the check guesses.
 */

import { useT } from "../root";
import { formatCents } from "../lib/money";
import { EntryIcon, IconAlert } from "./icons";
import type { DuplicateMatch } from "../lib/duplicates";

/** "Dinner · 12 Jun · €25.00 · paid by Ana" — enough to recognize the entry. */
function useMatchLine(memberName: Map<string, string>) {
  const { t, intl } = useT();
  const dateFormat = new Intl.DateTimeFormat(intl, { day: "numeric", month: "short" });
  return (match: DuplicateMatch) => {
    const { entry } = match;
    return [
      entry.title || t.catOther,
      dateFormat.format(new Date(`${entry.expenseDate}T12:00:00`)),
      formatCents(entry.amountCents, entry.currency, intl),
      `${t.paidBy} ${memberName.get(entry.payerId) ?? "?"}`,
    ].join(" · ");
  };
}

const TONE =
  "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400";

export function DuplicateNotice({
  matches,
  memberName,
}: {
  matches: DuplicateMatch[];
  memberName: Map<string, string>;
}) {
  const { t } = useT();
  const line = useMatchLine(memberName);
  if (matches.length === 0) return null;
  const likely = matches.some((m) => m.level === "likely");

  return (
    <div
      role="status"
      className={`animate-pop rounded-[var(--radius-card)] border px-3.5 py-3 ${TONE}`}
    >
      <p className="flex items-center gap-2 text-sm font-semibold">
        <IconAlert className="size-[1.15em] shrink-0" />
        {likely ? t.dupLikely : t.dupPossible}
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {matches.map((match) => (
          <li key={match.entry.id} className="flex items-center gap-2 text-sm">
            <EntryIcon
              kind={match.entry.kind}
              category={match.entry.category}
              className="size-[1.05rem] shrink-0 opacity-70"
            />
            <span className="min-w-0 flex-1 truncate">{line(match)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs opacity-80">{t.dupHint}</p>
    </div>
  );
}

/** The compact variant for a review row, where a whole panel would not fit. */
export function DuplicateLine({
  matches,
  memberName,
  className,
}: {
  matches: DuplicateMatch[];
  memberName: Map<string, string>;
  className?: string;
}) {
  const { t } = useT();
  const line = useMatchLine(memberName);
  if (matches.length === 0) return null;
  const [first] = matches;

  return (
    <p
      className={`flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400 ${className ?? ""}`}
    >
      <IconAlert className="mt-px size-3.5 shrink-0" />
      <span className="min-w-0">
        <span className="font-semibold">
          {first.level === "likely" ? t.dupLikely : t.dupPossible}
        </span>
        {": "}
        <span className="opacity-90">{line(first)}</span>
        {matches.length > 1 && <span className="opacity-90"> +{matches.length - 1}</span>}
      </span>
    </p>
  );
}
