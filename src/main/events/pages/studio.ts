import type { MessageKey } from "@/common/i18n";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  AppError,
  CAMERA_FAILURES,
  CameraConfig,
  FEEDBACK_CODES,
} from "@/common/types";
import { createStack } from "@/helper/events";
import { AppFailure, REPEAT_NOTICE_MS, saveFailure } from "@/helper/feedback";
import { t } from "@/helper/i18n";
import {
  liveNumbers,
  sendStudioMessage,
  sendStudioOverlay,
  sendStudioReact,
} from "@/helper/studio";
import Logger from "@/logger";
import { AppHandlerVariables, ReplyEvent } from "@/types";

const events = createStack("overlays");

// The largest camera chunk main takes: a 1080p keyframe is far smaller
const MAX_CAMERA_FRAME = 4 * 1024 * 1024;
const MAX_CAMERA_SIDE = 8192;

const isCameraSide = (side: unknown) =>
  typeof side === "number" &&
  Number.isInteger(side) &&
  side >= 1 &&
  side <= MAX_CAMERA_SIDE;

// A codec string as WebCodecs names one, like avc1.42001f
const isCameraConfig = (config: unknown): config is CameraConfig => {
  if (typeof config !== "object" || config === null) return false;
  const { codec, width, height }: Partial<Record<keyof CameraConfig, unknown>> =
    config;
  return (
    typeof codec === "string" &&
    /^[A-Za-z0-9._-]{1,64}$/.test(codec) &&
    isCameraSide(width) &&
    isCameraSide(height)
  );
};

// Every request is answered with the overlays main holds, failures included
const replyStudio = (
  e: ReplyEvent,
  { storeManagerService }: AppHandlerVariables,
) =>
  e.reply(APP_EVENTS_RESPONSE.STUDIO, {
    success: true,
    data: [...storeManagerService.getStudio()],
  });

const options = (message: MessageKey) => ({
  failure: { code: FEEDBACK_CODES.STUDIO_FAILED, message },
  onError: (
    e: ReplyEvent,
    error: AppError,
    _: unknown,
    { storeManagerService }: AppHandlerVariables,
  ) =>
    e.reply(APP_EVENTS_RESPONSE.STUDIO, {
      success: false,
      data: [...storeManagerService.getStudio()],
      error,
    }),
});

// The editor saved or tested, or the list deleted, an overlay that was deleted
// meanwhile
const missing = () =>
  new AppFailure(FEEDBACK_CODES.STUDIO_FAILED, t("main.studio.missing"), {
    level: "warning",
  });

events.push(
  APP_EVENTS.GET_STUDIO,
  async (handler, e) => replyStudio(e, handler),
  { ...options("main.failure.getStudio"), notify: false },
);

events.push(
  APP_EVENTS.ADD_STUDIO_OVERLAY,
  async (handler, e, { id, name }) => {
    const saved = await handler.storeManagerService.addStudioOverlay(id, name);
    if (saved === null) throw new Error(`Studio overlay ${id} is taken.`);
    // The page ignores the failure reply, so it keeps the list sent here.
    replyStudio(e, handler);
    if (!saved) throw saveFailure();
    handler.notifier.success(
      "overlays",
      FEEDBACK_CODES.STUDIO_OVERLAY_ADDED,
      t("main.studio.added", { name: name.trim() }),
    );
  },
  options("main.failure.addStudioOverlay"),
);

// The editor's autosave, so no notice
events.push(
  APP_EVENTS.SAVE_STUDIO_OVERLAY,
  async (handler, e, { overlay }) => {
    const saved = await handler.storeManagerService.saveStudioOverlay(overlay);
    if (saved === null) throw missing();
    replyStudio(e, handler);
    // Main holds the change even when the file wasn't written
    await sendStudioOverlay(handler, overlay.id);
    if (!saved) throw saveFailure();
  },
  options("main.failure.saveStudioOverlay"),
);

events.push(
  APP_EVENTS.REMOVE_STUDIO_OVERLAY,
  async (handler, e, { id }) => {
    const { storeManagerService, studioService, notifier } = handler;
    const saved = await storeManagerService.removeStudioOverlay(id);
    if (saved === null) throw missing();
    replyStudio(e, handler);
    sendStudioMessage(handler, id, { view: null });
    studioService.forget(id);
    if (!saved) throw saveFailure();
    notifier.success(
      "overlays",
      FEEDBACK_CODES.STUDIO_OVERLAY_REMOVED,
      t("main.studio.removed"),
    );
  },
  options("main.failure.removeStudioOverlay"),
);

// Plays every element that reacts on stream, with samples it doesn't keep. No
// page connected isn't a failure: the editor plays it on its own stage.
events.push(
  APP_EVENTS.TEST_STUDIO_OVERLAY,
  async (handler, e, { id }) => {
    const { storeManagerService, studioService } = handler;
    const overlay = storeManagerService.getStudio().find((o) => o.id === id);
    if (!overlay) throw missing();
    for (const react of studioService.test(overlay, liveNumbers(handler))) {
      sendStudioReact(handler, id, react);
    }
    replyStudio(e, handler);
  },
  { ...options("main.failure.testOverlay"), notify: false },
);

// The main window asks what to capture when it loads
events.push(
  APP_EVENTS.GET_CAMERAS,
  async ({ serverService }, e) =>
    e.reply(APP_EVENTS_RESPONSE.CAMERAS, {
      key: serverService.cameraKey,
      captures: serverService.cameraCaptures(),
    }),
  { notify: false },
);

// A chunk comes many times a second, from a page: anything that isn't an
// encoded chunk of a sane size is dropped
events.push(
  APP_EVENTS.CAMERA_FRAME,
  async ({ serverService }, _e, data) => {
    const { id, key, timestamp, frame, config }: Partial<typeof data> =
      data ?? {};
    if (typeof id !== "string" || typeof key !== "boolean") return;
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return;
    if (!(frame instanceof Uint8Array)) return;
    if (frame.byteLength < 1 || frame.byteLength > MAX_CAMERA_FRAME) return;
    if (config !== undefined && !isCameraConfig(config)) return;
    serverService.cameraFrame({ id, key, timestamp, frame, config });
  },
  { notify: false },
);

// The window tries again every few seconds while the camera is wanted, so
// the notice and its log go out at most once in REPEAT_NOTICE_MS
events.push(
  APP_EVENTS.CAMERA_FAILED,
  async ({ serverService, notifier, pathManagerService }, _e, data) => {
    const { id, reason }: Partial<typeof data> = data ?? {};
    if (!reason || !CAMERA_FAILURES.includes(reason)) return;
    const capture = serverService.cameraCaptures().find((c) => c.id === id);
    if (!capture) return;
    const name = capture.label || t("main.camera.default");
    const sent = notifier.warn(
      "overlays",
      FEEDBACK_CODES.CAMERA_FAILED,
      t(`main.camera.${reason}`, { name }),
      {
        key: `camera:${capture.device}\n${capture.label}`,
        windowMs: REPEAT_NOTICE_MS,
      },
    );
    if (!sent) return;
    // Logs stay English
    const camera = capture.label ? `"${capture.label}"` : "the default camera";
    Logger.warn(
      `<Studio> Unable to capture ${camera} (${reason})`,
      pathManagerService.files.logs.overlays,
    );
  },
  { notify: false },
);

export default events;
