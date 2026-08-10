import { describe, expect, it } from "vitest";

import { fromPasteEvent } from "./clipboard";

/** A paste event carries whatever the source app offered, in no fixed order. */
function pasteEvent(
  items: { kind: string; type: string; file?: Blob }[],
  text = "",
): ClipboardEvent {
  return {
    clipboardData: {
      items: items.map((item) => ({ ...item, getAsFile: () => item.file ?? null })),
      getData: (type: string) => (type === "text/plain" ? text : ""),
    },
  } as unknown as ClipboardEvent;
}

const png = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });

describe("fromPasteEvent", () => {
  it("prefers an image over the text that came with it", () => {
    // A screenshot copied out of a banking app often carries a text flavour
    // too, and it is never the useful one.
    const pasted = fromPasteEvent(
      pasteEvent([{ kind: "file", type: "image/png", file: png }], "Screenshot 2026-08-07.png"),
    );
    expect(pasted).toEqual({ kind: "image", blob: png });
  });

  it("takes text when there is no image", () => {
    const pasted = fromPasteEvent(pasteEvent([{ kind: "string", type: "text/plain" }], "  24,50 Döner  "));
    expect(pasted).toEqual({ kind: "text", text: "24,50 Döner" });
  });

  it("reports an empty clipboard, and whitespace counts as empty", () => {
    expect(fromPasteEvent(pasteEvent([], "   "))).toEqual({ kind: "empty" });
    expect(fromPasteEvent({ clipboardData: null } as unknown as ClipboardEvent)).toEqual({
      kind: "empty",
    });
  });

  it("ignores a non-image file", () => {
    const pdf = new Blob([new Uint8Array([1])], { type: "application/pdf" });
    expect(
      fromPasteEvent(pasteEvent([{ kind: "file", type: "application/pdf", file: pdf }], "note")),
    ).toEqual({ kind: "text", text: "note" });
  });
});
