import { defineConfig } from "@playwright/test";

// End-to-end tests launch the built app, see e2e/. `yarn test:e2e` builds it
// first.
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // One app at a time, they'd share the overlay server's port
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
});
