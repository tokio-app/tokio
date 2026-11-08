// import.meta.glob, which src/common/i18n loads the locale files with
/// <reference types="vite/types/importMeta.d.ts" />

// A file's text, loaded by Vite. electron-vite's types don't declare it.
declare module "*?raw" {
  const text: string;
  export default text;
}

// A TypeScript file as a classic script's text, see inlineScript in
// electron.vite.config.ts
declare module "*?script" {
  const code: string;
  export default code;
}

// A file as a data: URL, inlined by Vite. electron-vite's types cover ?asset.
declare module "*?inline" {
  const url: string;
  export default url;
}
