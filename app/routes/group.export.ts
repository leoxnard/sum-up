import type { Route } from "./+types/group.export";
import { loadSnapshot } from "../lib/server/queries.server";
import { toBaseCents } from "../lib/money";

function csvCell(value: string | number | null): string {
  let s = String(value ?? "");
  // Neutralize formula injection: a leading =, +, -, or @ is interpreted as a
  // live formula by Excel/Sheets. Anyone with the group link can set a title,
  // so this is untrusted input as far as the exported file is concerned.
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n;]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export async function loader({ params }: Route.LoaderArgs) {
  const snapshot = await loadSnapshot(params.slug);
  if (!snapshot) throw new Response("Not found", { status: 404 });

  const memberName = new Map(snapshot.members.map((m) => [m.id, m.name]));
  const name = (id: string | null) => (id ? (memberName.get(id) ?? id) : "");
  const base = snapshot.group.baseCurrency;

  const header = [
    "date", "kind", "title", "note", "category", "payer", "recipient",
    "amount", "currency", "exchange_rate", `amount_${base.toLowerCase()}`,
    "split_mode", "shares",
  ];
  const lines = [header.join(",")];
  for (const entry of [...snapshot.entries].reverse()) {
    const shares = entry.shares
      .map((s) => `${name(s.memberId)}: ${(s.shareCents / 100).toFixed(2)}`)
      .join("; ");
    lines.push(
      [
        entry.expenseDate,
        entry.kind,
        csvCell(entry.title),
        csvCell(entry.note),
        entry.category ?? "",
        csvCell(name(entry.payerId)),
        csvCell(name(entry.recipientId)),
        (entry.amountCents / 100).toFixed(2),
        entry.currency,
        entry.exchangeRate,
        (toBaseCents(entry.amountCents, entry.exchangeRate) / 100).toFixed(2),
        entry.kind === "expense" ? entry.splitMode : "",
        csvCell(shares),
      ].join(","),
    );
  }

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${snapshot.group.name.replace(/[^\w-]+/g, "_")}.csv"`,
    },
  });
}
