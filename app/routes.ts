import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("new", "routes/new-group.tsx"),
  route("api/sync", "routes/api.sync.ts"),
  route("api/rates", "routes/api.rates.ts"),
  route("g/:slug", "routes/group.tsx", [
    index("routes/group._index.tsx"),
    route("new-expense", "routes/group.new-expense.tsx"),
    route("new-payment", "routes/group.new-payment.tsx"),
    route("entry/:entryId", "routes/group.entry.tsx"),
    route("settle", "routes/group.settle.tsx"),
    route("stats", "routes/group.stats.tsx"),
    route("settings", "routes/group.settings.tsx"),
  ]),
  route("g/:slug/export.csv", "routes/group.export.ts"),
  route("g/:slug/photo/:photoId", "routes/group.photo.ts"),
] satisfies RouteConfig;
