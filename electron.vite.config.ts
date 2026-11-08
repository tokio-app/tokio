import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { readFileSync } from "fs";
import { readFile } from "fs/promises";
import { basename, extname, resolve } from "path";
import { transformWithEsbuild, type Plugin } from "vite";
import { CSP } from "./src/main/config/csp";

// NOTE: The bundler drops file header comments, keep this notice in sync with THIRD_PARTY_NOTICES.md.
const MAIN_LICENSE_BANNER = `/*!
 * Tokio - source code under the MIT License, see resources/licenses/LICENSE.
 * Includes src/main/services/tts/providers/edge/common/drm-v2.ts, derived from
 * edge-tts (https://github.com/rany2/edge-tts) and licensed LGPL-3.0-only.
 * Includes the Archivo font (@fontsource-variable/archivo), licensed under the
 * SIL Open Font License 1.1.
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

/**
 * `import CODE from "./stage.ts?script"`: the file as the text of a classic
 * script, for a page main serves to inline. It's compiled alone, not bundled,
 * so it may only import types; its exports land on a global named after it
 * (stage.ts → TokioStage). Chromium 103, OBS 30's browser, runs it.
 * Vitest's main project uses it too.
 */
export function inlineScript(): Plugin {
  return {
    name: "tokio:script",
    enforce: "pre",
    async load(id) {
      const [file, query] = id.split("?");
      if (query !== "script") return null;
      this.addWatchFile(file);
      const name = basename(file, extname(file));
      const { code } = await transformWithEsbuild(
        await readFile(file, "utf8"),
        file,
        {
          loader: "ts",
          format: "iife",
          globalName: `Tokio${name[0].toUpperCase()}${name.slice(1)}`,
          target: "chrome103",
        },
      );
      return `export default ${JSON.stringify(code)};`;
    },
  };
}

// Packaged pages load from file://, which the header set in initSession can't reach.
function cspMeta(policy: string): Plugin {
  return {
    name: "tokio:csp",
    apply: "build",
    transformIndexHtml: () => [
      {
        tag: "meta",
        attrs: { "http-equiv": "Content-Security-Policy", content: policy },
        injectTo: "head-prepend",
      },
    ],
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
    build: {
      // Bundled, so the timer overlay's ?inline font import becomes a data URL
      externalizeDeps: { exclude: ["@fontsource-variable/archivo"] },
    },
    plugins: [licenseBanner(MAIN_LICENSE_BANNER), inlineScript()],
  },
  preload: {
    // A sandboxed preload can't load ES modules.
    build: { rollupOptions: { output: { format: "cjs" } } },
  },
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
      // Vite inlines small files as data: URLs, which the CSP blocks for fonts
      assetsInlineLimit: 0,
      rollupOptions: {
        input: {
          index: resolve("src/renderer/index.html"),
          splash: resolve("src/renderer/splash.html"),
        },
      },
    },
    plugins: [react(), cspMeta(CSP.prod)],
  },
});
