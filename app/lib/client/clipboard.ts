/**
 * Reading whatever is currently in the clipboard, so a screenshot can be
 * imported with one tap instead of being saved to disk and picked again.
 */

export type Pasted =
  | { kind: "image"; blob: Blob }
  | { kind: "text"; text: string }
  | { kind: "empty" };

/** Chrome and Safari expose `read()`; Firefox only offers it behind a real paste. */
export function canReadClipboard(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.clipboard?.read === "function";
}

/**
 * Read the clipboard on a button press. Rejects with "denied" when the browser
 * refuses (no permission, no user gesture) — the caller can then fall back to
 * telling the user to press ⌘V, which goes through `fromPasteEvent` instead.
 */
export async function readClipboard(): Promise<Pasted> {
  if (!canReadClipboard()) throw new Error("denied");
  let items: ClipboardItems;
  try {
    items = await navigator.clipboard.read();
  } catch {
    throw new Error("denied");
  }

  // An image wins over text: a screenshot copied from a banking app carries a
  // text/plain flavour too on some platforms, and it is never the useful one.
  for (const item of items) {
    const type = item.types.find((t) => t.startsWith("image/"));
    if (type) return { kind: "image", blob: await item.getType(type) };
  }
  for (const item of items) {
    if (!item.types.includes("text/plain")) continue;
    const text = (await (await item.getType("text/plain")).text()).trim();
    if (text) return { kind: "text", text };
  }
  return { kind: "empty" };
}

/** The same decision for a real paste event (⌘V / Strg+V), which needs no permission. */
export function fromPasteEvent(event: ClipboardEvent): Pasted {
  const data = event.clipboardData;
  if (!data) return { kind: "empty" };
  for (const item of data.items) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const blob = item.getAsFile();
    if (blob) return { kind: "image", blob };
  }
  const text = data.getData("text/plain").trim();
  return text ? { kind: "text", text } : { kind: "empty" };
}
