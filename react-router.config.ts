import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  // Ship the full route manifest upfront: lazy route discovery fetches
  // manifest patches per navigation, which breaks offline navigation.
  routeDiscovery: { mode: "initial" },
} satisfies Config;
