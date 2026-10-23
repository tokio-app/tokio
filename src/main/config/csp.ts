// No imports: electron.vite.config.ts reads it for the builds' meta tag.
// tokio-media: is MEDIA_SCHEME, the media library's thumbnails.
export const CSP = {
  prod: "default-src 'self'; frame-src * local-resource: 'self'; media-src 'self' blob: tokio-media:; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self' 'unsafe-inline' blob:; img-src 'self' data: http: https: tokio-media:;",
  dev: "default-src 'self'; frame-src * local-resource: 'self'; media-src 'self' blob: tokio-media:; script-src 'self' 'unsafe-inline' http: https:; style-src 'self' 'unsafe-inline'; worker-src 'self' 'unsafe-inline' blob:; connect-src 'self' *; img-src 'self' data: http: https: tokio-media:;",
};
