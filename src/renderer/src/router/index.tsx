import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  ErrorComponent,
} from "@tanstack/react-router";
import {
  About,
  Alerts,
  Home,
  Music,
  OfficialOverlays,
  Overlays,
  Settings,
  Tools,
  TTS,
} from "../pages";
import { Layout } from "./Layout";

const rootRoute = createRootRoute({
  component: Layout,
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Home,
});

const overlaysRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/overlays",
  component: Overlays,
});

// Opened from the gallery. Under /overlays, so the sidebar keeps Overlays
// active.
const officialOverlaysRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/overlays/official",
  component: OfficialOverlays,
});

const ttsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tts",
  component: TTS,
});

const alertsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/alerts",
  component: Alerts,
});

const musicRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/music",
  component: Music,
});

const toolsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tools",
  component: Tools,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: Settings,
});

const aboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/about",
  component: About,
});

const routeTree = rootRoute.addChildren([
  homeRoute,
  overlaysRoute,
  officialOverlaysRoute,
  ttsRoute,
  alertsRoute,
  musicRoute,
  toolsRoute,
  settingsRoute,
  aboutRoute,
]);

// Exported for tests, which render the routes in memory history
export const routerOptions = {
  routeTree,
  // Keeps a page's error inside the page, with the title bar and sidebar
  defaultErrorComponent: ErrorComponent,
};

export const router = createRouter({
  ...routerOptions,
  history: createHashHistory(),
});
