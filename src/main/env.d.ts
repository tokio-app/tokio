// A file's text, loaded by Vite. electron-vite's types don't declare it.
declare module "*?raw" {
  const text: string;
  export default text;
}

// A file as a data: URL, inlined by Vite. electron-vite's types cover ?asset.
declare module "*?inline" {
  const url: string;
  export default url;
}
