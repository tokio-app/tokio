import react from "@vitejs/plugin-react";
import { readFileSync } from "fs";
import { resolve } from "path";
import { defineConfig } from "vitest/config";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));

// Each project has its own aliases: both map "@", and a merged map would keep
// the main process's "@" ahead of the renderer's "@/ui".
export default defineConfig({
  test: {
    restoreMocks: true,
    unstubGlobals: true,
    projects: [
      {
        extends: true,
        resolve: {
          // Same aliases as the main process in electron.vite.config.ts
          alias: {
            "@test": resolve("test/main"),
            "@/common": resolve("src/common"),
            "@": resolve("src/main"),
          },
        },
        test: {
          name: "main",
          environment: "node",
          include: [
            "src/main/**/*.test.ts",
            "src/common/**/*.test.ts",
            "src/preload/**/*.test.ts",
            "scripts/**/*.test.js",
          ],
          setupFiles: ["test/setup.ts"],
        },
      },
      {
        extends: true,
        plugins: [react()],
        resolve: {
          // Same aliases as the renderer in electron.vite.config.ts
          alias: {
            "@test": resolve("test/renderer"),
            "@renderer": resolve("src/renderer/src"),
            "@/common": resolve("src/common"),
            "@/ui": resolve("src/ui"),
            "@": resolve("src/renderer/src"),
          },
        },
        define: {
          __APP_VERSION__: JSON.stringify(version),
        },
        test: {
          name: "renderer",
          environment: "jsdom",
          include: ["src/{renderer,ui,music}/**/*.test.{ts,tsx}"],
          setupFiles: ["test/renderer/setup.ts"],
        },
      },
    ],
  },
});
