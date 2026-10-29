/**
 * The ref of an `<audio>` or `<video>`, which drops the element's source
 * once React removes it. Chromium keeps a detached player that still has a
 * source alive, and with it the page section it was in.
 *
 * It waits a microtask and leaves an element still in the document, since
 * StrictMode runs the cleanup and attaches the ref again at once in
 * development.
 */
export function releaseOnUnmount(el: HTMLMediaElement | null) {
  return () => {
    queueMicrotask(() => {
      if (!el || el.isConnected) return;
      el.pause();
      // Removed rather than emptied, which would fire an error
      el.removeAttribute("src");
      el.load();
    });
  };
}
