import { defineConfig } from "vitest/config";

// Deliberately does NOT load the reactRouter() plugin from vite.config.ts: that
// plugin wants a full route build, and everything under test here is pure
// logic with no DOM, no DB and no network.
export default defineConfig({
  test: {
    environment: "node",
    include: ["app/**/*.test.ts"],
  },
});
