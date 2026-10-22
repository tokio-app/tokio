import react from "@vitejs/plugin-react";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  base: "./",
  resolve: {
    alias: {
      "@/common": resolve(__dirname, "../common"),
      "@/ui": resolve(__dirname, "../ui"),
    },
  },
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, "../../music-out"),
    emptyOutDir: true,
    // Vite inlines small files as data: URLs, which the CSP blocks for fonts
    assetsInlineLimit: 0,
  },
});
