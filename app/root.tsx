import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router";
import { useEffect } from "react";

import type { Route } from "./+types/root";
import "./app.css";
import { getLocale } from "./lib/server/cookies.server";
import { dict, INTL_LOCALE, type Locale } from "./lib/i18n";

export function loader({ request }: Route.LoaderArgs) {
  return {
    locale: getLocale(request),
    supabase:
      process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
        ? { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_ANON_KEY }
        : null,
  };
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
        <meta name="theme-color" content="#0f172a" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
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
      <p className="mt-2 text-[var(--text-muted)]">{details}</p>
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
