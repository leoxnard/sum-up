import postgres from "postgres";

declare global {
  // Reuse the pool across dev HMR reloads.
  var __sumupSql: ReturnType<typeof postgres> | undefined;
}

function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return postgres(url, {
    // Supavisor transaction pooling does not support prepared statements.
    prepare: false,
    max: 4,
    idle_timeout: 20,
    connect_timeout: 10,
  });
}

export const sql = globalThis.__sumupSql ?? (globalThis.__sumupSql = createClient());
