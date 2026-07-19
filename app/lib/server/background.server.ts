/**
 * Run work after the response is sent. On Vercel this registers with waitUntil
 * so the function isn't frozen mid-task; elsewhere the promise just runs on the
 * long-lived Node process. Errors are always swallowed — background work must
 * never break a request.
 */
export function runInBackground(task: () => Promise<unknown>): void {
  const promise = task().catch(() => {});
  import("@vercel/functions")
    .then(({ waitUntil }) => waitUntil(promise))
    .catch(() => {});
}
