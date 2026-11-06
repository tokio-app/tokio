import type { MessageKey } from "@/common/i18n";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  AppError,
  FEEDBACK_CODES,
} from "@/common/types";
import { createStack } from "@/helper/events";
import { AppFailure, saveFailure } from "@/helper/feedback";
import { t } from "@/helper/i18n";
import {
  liveNumbers,
  sendStudioMessage,
  sendStudioOverlay,
  sendStudioReact,
} from "@/helper/studio";
import { AppHandlerVariables, ReplyEvent } from "@/types";

const events = createStack("overlays");

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

// The editor saved or tested an overlay that was deleted meanwhile
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

// Plays every layer that reacts on stream, with samples it doesn't keep. No
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

export default events;
