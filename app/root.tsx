import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router";
import type { ShouldRevalidateFunctionArgs } from "react-router";
import { useEffect } from "react";

import type { Route } from "./+types/root";
import "./app.css";
import { getLocale } from "./lib/server/cookies.server";
import { dict, INTL_LOCALE, type Locale } from "./lib/i18n";
import { Analytics } from "./components/Analytics";

/**
 * Security headers, set by the app rather than by the host.
 *
 * These used to live in `vercel.json`. That file is Vercel-only configuration,
 * so the move to a self-hosted container silently dropped every one of them —
 * the app served no `Referrer-Policy`, no `X-Frame-Options`, no `nosniff` and
 * no `X-Robots-Tag` for months without anything failing. Owning them here means
 * they survive the next move too.
 *
 * `X-Robots-Tag` on `/g/*` is the HTTP half of the rule that a group link is a
 * bearer credential; `group.tsx` sets the matching `robots` meta tag, and a
 * crawler that reads only headers must reach the same conclusion.
 */
const securityHeaders: Route.MiddlewareFunction = async ({ request }, next) => {
  const response = await next();
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  if (new URL(request.url).pathname.startsWith("/g/")) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return response;
};

export const middleware: Route.MiddlewareFunction[] = [securityHeaders];

export function loader({ request }: Route.LoaderArgs) {
  return {
    locale: getLocale(request),
    supabase:
      process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
        ? { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_ANON_KEY }
        : null,
  };
}

/**
 * Root's data is the locale cookie and the Supabase config — neither changes
 * because you navigated. Without this, single fetch reloads it on every client
 * navigation, so even changing a tab hit the network. Same-URL calls still pass
 * through, which is how switching the language (an explicit `revalidate()`)
 * still takes effect.
 */
export function shouldRevalidate({
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  return currentUrl.pathname === nextUrl.pathname ? defaultShouldRevalidate : false;
}

// Offline navigations can't reach the server loader; fall back to the last
// known locale so the app shell still renders.
export async function clientLoader({ serverLoader }: Route.ClientLoaderArgs) {
  try {
    const data = await serverLoader();
    localStorage.setItem("sumup_root", JSON.stringify(data));
    return data;
  } catch {
    const cached = localStorage.getItem("sumup_root");
    if (cached) return JSON.parse(cached) as Awaited<ReturnType<typeof loader>>;
    return { locale: "en" as Locale, supabase: null };
  }
}

export function useLocale(): Locale {
  const data = useRouteLoaderData<typeof loader>("root");
  return data?.locale ?? "en";
}

export function useT() {
  const locale = useLocale();
  return { t: dict(locale), locale, intl: INTL_LOCALE[locale] };
}

export function useSupabaseConfig() {
  const data = useRouteLoaderData<typeof loader>("root");
  return data?.supabase ?? null;
}

export const links: Route.LinksFunction = () => [
  { rel: "manifest", href: "/manifest.webmanifest" },
  { rel: "icon", href: "/icons/icon.svg", type: "image/svg+xml" },
  { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" },
  // Plus Jakarta Sans for the interface, Space Grotesk for every figure. Both
  // are progressive: offline, or if fonts.googleapis.com is blocked, the stacks
  // in app.css fall back to the system UI face and the layout is unchanged.
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Space+Grotesk:wght@400;500;600;700&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root");
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return (
    <html lang={data?.locale ?? "en"}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        {/* Matches the top of the page gradient so the iOS status-bar area
            blends into the app instead of banding against it. */}
        <meta name="theme-color" content="#f4f6fa" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#0b0d11" media="(prefers-color-scheme: dark)" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
        {/* Reports to our own Umami instance. The slug IS the group's
            credential and it lives in the path, so app/lib/analytics.ts strips
            it before anything is sent. */}
        <Analytics />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="animate-rise mx-auto max-w-md px-4 pt-16">
      <h1 className="text-2xl font-bold tracking-tight">{message}</h1>
      <p className="mt-2 text-[var(--text-2)]">{details}</p>
      <a href="/" className="btn btn-outline mt-6">
        Sum Up
      </a>
      {stack && (
        <pre className="mt-4 w-full overflow-x-auto p-4 text-xs">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
