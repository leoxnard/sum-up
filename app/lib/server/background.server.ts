/**
 * Run work after the response is sent.
 *
 * The app runs as a long-lived Node process in a container, so a detached
 * promise simply keeps running — there is no serverless freeze to defend
 * against. (This used to register with Vercel's `waitUntil`; that dependency
 * went away with Vercel itself.)
 *
 * Errors are always swallowed: background work must never break a request.
 */
export function runInBackground(task: () => Promise<unknown>): void {
  void task().catch(() => {});
}
