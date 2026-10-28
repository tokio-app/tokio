import { translate } from "@/common/i18n";
import { APP_EVENTS, TokioPayload, TokioPreviewMessage } from "@/common/types";

/**
 * The hint on Official Overlays while installed ones have updates, or
 * undefined without any.
 */
export function updatesHint(
  count: number,
  language: string,
): string | undefined {
  if (count === 0) return undefined;
  return translate(language, "overlays.updates", { count });
}

/**
 * Sends a payload to an overlay's preview iframes: the card, its full size
 * view and the settings preview.
 */
export function postToPreviews(id: string, payload: TokioPayload) {
  const targets = document.querySelectorAll<HTMLIFrameElement>(
    `iframe[name="${CSS.escape(`TOKIO_APP-${id}`)}"]`,
  );

  if (targets.length === 0) {
    console.warn(`Iframe ${id} not found or not loaded yet.`);
    return;
  }

  const message: TokioPreviewMessage = { action: "TOKIO_PREVIEW", payload };
  for (const target of targets) target.contentWindow?.postMessage(message, "*");
}

/**
 * Sends a payload to an overlay's previews, and to its live instances through
 * main.
 */
export function postToOverlay(id: string, payload: TokioPayload) {
  postToPreviews(id, payload);
  window.api.emit(APP_EVENTS.SEND_OVERLAY_DATA, { id, payload });
}
