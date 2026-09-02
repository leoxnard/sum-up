import { describe, expect, it } from "vitest";

import { scrubUrl } from "./analytics";

// The slug IS the group's credential. If it ever reached the analytics
// database it would sit there in plain text — these tests are the boundary
// that stops it.
describe("scrubUrl", () => {
  it("strips the group slug", () => {
    expect(scrubUrl("/g/a8f2c1d9")).toBe("/g/[slug]");
  });

  it("keeps the tab under the group", () => {
    expect(scrubUrl("/g/a8f2c1d9/stats")).toBe("/g/[slug]/stats");
    expect(scrubUrl("/g/a8f2c1d9/entry/42")).toBe("/g/[slug]/entry/42");
  });

  it("strips the slug from the export and photo endpoints", () => {
    expect(scrubUrl("/g/a8f2c1d9/export.csv")).toBe("/g/[slug]/export.csv");
    expect(scrubUrl("/g/a8f2c1d9/photo/7")).toBe("/g/[slug]/photo/7");
  });

  it("keeps the query without leaking the slug", () => {
    expect(scrubUrl("/g/a8f2c1d9/stats?range=month")).toBe(
      "/g/[slug]/stats?range=month",
    );
  });

  it("leaves slug-free pages alone", () => {
    expect(scrubUrl("/")).toBe("/");
    expect(scrubUrl("/new")).toBe("/new");
  });
});
