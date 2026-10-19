import { RouterProvider } from "@tanstack/react-router";
import { AppProvider, AudioProvider, NotificationsProvider } from "./context";
import { router } from "./router";

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export default function App() {
  return (
    <AudioProvider>
      {/* Outside AppProvider, so notices sent while loading are shown */}
      <NotificationsProvider>
        <AppProvider>
          <RouterProvider router={router} />
        </AppProvider>
      </NotificationsProvider>
    </AudioProvider>
  );
}
