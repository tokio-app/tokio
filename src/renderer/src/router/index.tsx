import { Btn } from "@/components/Elements";
import { EmptyState, Page, Section } from "@/components/Page";
import { useT } from "@/ui/i18n";
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  ErrorComponentProps,
} from "@tanstack/react-router";
import { useState } from "react";
import {
  About,
  Alerts,
  CoinStats,
  CountdownTimer,
  Fans,
  Games,
  Home,
  Library,
  Music,
  OfficialOverlays,
  Overlays,
  Settings,
  Studio,
  StudioEditor,
  TestOverlays,
  Tools,
  TTS,
} from "../pages";
import { Layout } from "./Layout";

// TanStack's own error and not found pages, in the window's language
function RouteError({ error }: ErrorComponentProps) {
  const t = useT();
  const [show, setShow] = useState(false);
  return (
    <Page>
      <Section title={t("layout.error.title")}>
        {/* Wrapped, or the section's column stretches it */}
        <div>
          <Btn onClick={() => setShow(!show)}>
            {show ? t("layout.error.hide") : t("layout.error.show")}
          </Btn>
        </div>
        {show && (
          <EmptyState>
            {error instanceof Error ? error.message : String(error)}
          </EmptyState>
        )}
      </Section>
    </Page>
  );
}

function NotFound() {
  const t = useT();
  return (
    <Page>
      <EmptyState>{t("layout.notFound")}</EmptyState>
    </Page>
  );
}

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

// Opened from Alerts. Under /alerts, so the sidebar keeps Alerts active.
const libraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/alerts/library",
  component: Library,
});

const musicRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/music",
  component: Music,
});

const gamesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/games",
  component: Games,
});

const toolsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tools",
  component: Tools,
});

// The tools, opened from Tools. Under /tools, so the sidebar keeps Tools
// active.
const countdownTimerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tools/timer",
  component: CountdownTimer,
});

const studioRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tools/studio",
  component: Studio,
});

// Flat like the others, so the list doesn't stay mounted under the editor
const studioEditorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tools/studio/$id",
  component: StudioEditor,
});

const coinStatsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tools/coin-stats",
  component: CoinStats,
});

const fansRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tools/fans",
  component: Fans,
});

const testOverlaysRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tools/test-overlays",
  component: TestOverlays,
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
  libraryRoute,
  musicRoute,
  gamesRoute,
  toolsRoute,
  countdownTimerRoute,
  studioRoute,
  studioEditorRoute,
  coinStatsRoute,
  fansRoute,
  testOverlaysRoute,
  settingsRoute,
  aboutRoute,
]);

// Exported for tests, which render the routes in memory history
export const routerOptions = {
  routeTree,
  // Keeps a page's error inside the page, with the title bar and sidebar
  defaultErrorComponent: RouteError,
  defaultNotFoundComponent: NotFound,
};

export const router = createRouter({
  ...routerOptions,
  history: createHashHistory(),
});
