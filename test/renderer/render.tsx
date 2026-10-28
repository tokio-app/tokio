import { AudioContext } from "@/context/audio";
import { NotificationsProvider } from "@/context/notifications";
import { LanguageProvider } from "@/ui/i18n";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, RenderOptions, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactElement, ReactNode } from "react";
import { createAudio } from "./audio";

type Options = Omit<RenderOptions, "wrapper"> & {
  // With fake timers: { advanceTimers: (ms) => vi.advanceTimersByTime(ms) }
  user?: Parameters<typeof userEvent.setup>[0];
};

/**
 * The providers App mounts, with fake audio queues. AppProvider is left out,
 * it waits for main to load (see its own tests).
 */
export function providers() {
  const audio = createAudio();

  // jsdom's page has no ?lang, so it's English
  const wrapper = ({ children }: { children: ReactNode }) => (
    <LanguageProvider>
      <AudioContext.Provider value={audio.value}>
        <NotificationsProvider>{children}</NotificationsProvider>
      </AudioContext.Provider>
    </LanguageProvider>
  );

  return { wrapper, audio };
}

/** Renders inside the app's providers, with a user to drive it. */
export function renderWithProviders(
  ui: ReactElement,
  { user, ...options }: Options = {},
) {
  const { wrapper, audio } = providers();
  return {
    ...render(ui, { ...options, wrapper }),
    user: userEvent.setup(user),
    audio,
  };
}

/** Renders the app's routes at `path`, with the layout and the sidebar. */
export async function renderApp(path = "/", options?: Options) {
  // Loaded here, so tests that don't need the pages don't import them all
  const { routerOptions } = await import("@/router");
  const router = createRouter({
    ...routerOptions,
    history: createMemoryHistory({ initialEntries: [path] }),
  });

  const result = renderWithProviders(
    <RouterProvider router={router} />,
    options,
  );
  await screen.findByRole("navigation");
  return { ...result, router };
}
