import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  // Home is a layout, not an index: "new group" is drawn as a sheet over the
  // group list, and a sheet needs its host still mounted underneath.
  route("/", "routes/home.tsx", [route("new", "routes/new-group.tsx")]),
  route("api/sync", "routes/api.sync.ts"),
  route("api/rates", "routes/api.rates.ts"),
  route("api/groups", "routes/api.groups.ts"),
  route("g/:slug", "routes/group.tsx", [
    // Tabs — the four destinations in the floating capsule bar.
    index("routes/group._index.tsx"),
    route("activity", "routes/group.activity.tsx"),
    route("stats", "routes/group.stats.tsx"),
    route("settings", "routes/group.settings.tsx"),
    // Sheets.
    route("new-expense", "routes/group.new-expense.tsx"),
    route("new-payment", "routes/group.new-payment.tsx"),
    route("import", "routes/group.import.tsx"),
    // Push panels.
    route("entry/:entryId", "routes/group.entry.tsx"),
    route("settle", "routes/group.settle.tsx"),
  ]),
  route("legal", "routes/legal.tsx"),
  route("g/:slug/export.csv", "routes/group.export.ts"),
  route("g/:slug/photo/:photoId", "routes/group.photo.ts"),
] satisfies RouteConfig;
