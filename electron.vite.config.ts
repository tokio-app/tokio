import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { readFileSync } from "fs";
import { resolve } from "path";
import type { Plugin } from "vite";

// NOTE: The bundler drops file header comments, keep this notice in sync with THIRD_PARTY_NOTICES.md.
const MAIN_LICENSE_BANNER = `/*!
 * Tokio - source code under the MIT License, see resources/licenses/LICENSE.
 * Includes src/main/services/tts/providers/edge/common/drm-v2.ts, derived from
 * edge-tts (https://github.com/rany2/edge-tts) and licensed LGPL-3.0-only.
 * Source: https://github.com/tokio-app/tokio
 * See resources/licenses/THIRD_PARTY_NOTICES.md and resources/licenses/LICENSES.
 */`;

// Prepends the banner after every other transform, so nothing can strip it.
function licenseBanner(banner: string): Plugin {
  return {
    name: "tokio:license-banner",
    enforce: "post",
    generateBundle(_, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === "chunk" && chunk.isEntry) {
          chunk.code = `${banner}\n${chunk.code}`;
        }
      }
    },
  };
}

const { version } = JSON.parse(readFileSync("package.json", "utf8"));

export default defineConfig({
  main: {
    resolve: {
      alias: {
        "@/common": resolve("src/common"),
        "@": resolve("src/main"),
      },
    },
    plugins: [licenseBanner(MAIN_LICENSE_BANNER)],
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src"),
        "@/common": resolve("src/common"),
        "@/ui": resolve("src/ui"),
        "@": resolve("src/renderer/src"),
      },
    },
    define: {
      __APP_VERSION__: JSON.stringify(version),
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/renderer/index.html"),
          splash: resolve("src/renderer/splash.html"),
        },
      },
    },
    plugins: [react()],
  },
});
