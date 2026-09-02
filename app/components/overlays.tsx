/**
 * Route-backed overlays.
 *
 * Every screen that the design draws as a bottom sheet or a pushed-in detail
 * panel is still a real route with a real URL — that is what keeps the back
 * button, deep links and the service worker's per-URL page cache working. The
 * components here only supply the presentation: the enter animation on mount,
 * and — because a route unmounts the instant you navigate — an explicit exit
 * animation that finishes *before* the navigation is issued.
 */

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { useT } from "../root";
import { IconArrowLeft } from "./icons";

/** Long enough for the exit keyframes; skipped when motion is reduced. */
const EXIT_MS = 260;

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

const DismissContext = createContext<() => void>(() => {});

/**
 * Dismiss the overlay the caller sits inside. Any control that closes a sheet
 * (Cancel, the scrim, Escape, a save that is done) should call this rather than
 * navigating itself, so the exit animation always plays.
 */
export function useDismiss() {
  return useContext(DismissContext);
}

function useExit(backTo: string) {
  const navigate = useNavigate();
  const [closing, setClosing] = useState(false);

  const dismiss = useCallback(() => {
    if (closing) return;
    setClosing(true);
    if (prefersReducedMotion()) {
      void navigate(backTo);
      return;
    }
    window.setTimeout(() => void navigate(backTo), EXIT_MS);
  }, [backTo, closing, navigate]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dismiss]);

  return { closing, dismiss };
}

/** Freeze the page behind while an overlay owns the screen. */
function useScrollLock() {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);
}

export function Sheet({
  backTo,
  label,
  wide = false,
  children,
}: {
  /** Where dismissing returns to — the URL this sheet was opened from. */
  backTo: string;
  label: string;
  /** Room for a two-column layout — the capture review needs it on a desktop. */
  wide?: boolean;
  children: React.ReactNode;
}) {
  const { closing, dismiss } = useExit(backTo);
  useScrollLock();

  return (
    <DismissContext.Provider value={dismiss}>
      <div
        className="sheet-scrim"
        data-closing={closing}
        onClick={dismiss}
        aria-hidden
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`sheet mx-auto ${wide ? "max-w-3xl" : "max-w-lg"}`}
        data-closing={closing}
      >
        <span className="sheet-grip" aria-hidden />
        {children}
      </section>
    </DismissContext.Provider>
  );
}

export function SheetHead({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}) {
  const dismiss = useDismiss();
  const { t } = useT();
  return (
    <header className="sheet-head">
      <button
        type="button"
        onClick={dismiss}
        className="-ml-1 shrink-0 px-1 py-1 text-[0.9375rem] font-semibold text-[var(--text-2)]"
      >
        {t.cancel}
      </button>
      <h2 className="min-w-0 flex-1 truncate text-center text-base font-bold">{title}</h2>
      {/* Balances the cancel button so the title stays optically centred. */}
      <div className="flex min-w-[3.25rem] shrink-0 justify-end">{action}</div>
    </header>
  );
}

/**
 * A detail screen that slides in from the right over the group. Used for the
 * routes you drill into and come back from — settle, and editing an entry.
 */
export function PushPanel({
  backTo,
  title,
  children,
  action,
}: {
  backTo: string;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  const { dismiss } = useExit(backTo);
  const { t } = useT();
  useScrollLock();

  return (
    <DismissContext.Provider value={dismiss}>
      <section className="push-panel" aria-label={title}>
        <div className="mx-auto max-w-lg px-5 pb-16 pt-[max(1rem,env(safe-area-inset-top))]">
          <header className="mb-5 flex items-center gap-2">
            <button
              type="button"
              onClick={dismiss}
              aria-label={t.cancel}
              className="glass-btn"
            >
              <IconArrowLeft className="size-4" />
            </button>
            <h1 className="min-w-0 flex-1 truncate text-[1.625rem] font-extrabold tracking-tight">
              {title}
            </h1>
            {action}
          </header>
          {children}
        </div>
      </section>
    </DismissContext.Provider>
  );
}
