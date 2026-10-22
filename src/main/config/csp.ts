// No imports: electron.vite.config.ts reads it for the builds' meta tag.
export const CSP = {
  prod: "default-src 'self'; frame-src * local-resource: 'self'; media-src 'self' blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self' 'unsafe-inline' blob:; img-src 'self' data: http: https:;",
  dev: "default-src 'self'; frame-src * local-resource: 'self'; media-src 'self' blob:; script-src 'self' 'unsafe-inline' http: https:; style-src 'self' 'unsafe-inline'; worker-src 'self' 'unsafe-inline' blob:; connect-src 'self' *; img-src 'self' data: http: https:;",
};
