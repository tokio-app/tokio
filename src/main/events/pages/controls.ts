import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  CONTROL_ACTIONS,
  ControlAction,
  FEEDBACK_CODES,
} from "@/common/types";
import { createStack } from "@/helper/events";
import { saveFailure } from "@/helper/feedback";
import { applyStoredShortcuts, warnTaken } from "@/helper/shortcuts";
import { AppHandlerVariables } from "@/types";
import { globalShortcut } from "electron";
import { z } from "zod";
import { replySettings } from "./settings";

const events = createStack("system");

// The HTTP API and MCP reach it through invoke, with whatever they were sent
const ControlSchema = z.object({
  action: z.enum(CONTROL_ACTIONS),
  paused: z.boolean().optional(),
});

// Always together: TTS_CLEAR alone stalls chat TTS until its holds time out
const stopTts = ({ ttsService, win }: AppHandlerVariables) => {
  ttsService.clearTalk();
  if (!win.isDestroyed()) {
    win.webContents.send(APP_EVENTS_RESPONSE.TTS_CLEAR, undefined);
  }
};

// Each action, returning whether there was something to do
const CONTROLS: Record<
  ControlAction,
  (handler: AppHandlerVariables, paused?: boolean) => boolean
> = {
  skipSong: ({ musicService }) => musicService.skip(),
  stopTts: (handler) => {
    stopTts(handler);
    return true;
  },
  // Once each, even with alerts off or paused: it's an explicit press
  replayAlert: ({ controlsService, win }) => {
    const alerts = controlsService.lastAlerts();
    for (const audio of alerts) {
      if (win.isDestroyed()) break;
      win.webContents.send(APP_EVENTS_RESPONSE.ALERT_AUDIO, {
        ...audio,
        repeat: 1,
      });
    }
    return alerts.length > 0;
  },
  pause: (handler, paused) => {
    const { controlsService, alertsService, gamesService, win } = handler;
    const next = paused ?? !controlsService.isPaused();
    // Nothing from before the pause plays later
    if (next) {
      stopTts(handler);
      alertsService.clear();
      if (!win.isDestroyed()) {
        win.webContents.send(APP_EVENTS_RESPONSE.ALERT_CLEAR, undefined);
      }
      gamesService.stopRuns();
    }
    return controlsService.setPaused(next);
  },
};

// No success notice: the effect is audible, and a LIVE's skips would fill
// the bell
events.push(
  APP_EVENTS.CONTROL,
  (handler, e, data) => {
    const control = ControlSchema.parse(data);
    const done = CONTROLS[control.action](handler, control.paused);
    e.reply(APP_EVENTS_RESPONSE.CONTROL, {
      success: true,
      action: control.action,
      done,
      paused: handler.controlsService.isPaused(),
    });
  },
  {
    failure: {
      code: FEEDBACK_CODES.CONTROL_FAILED,
      message: "main.failure.control",
    },
    onError: (e, error, { action }, { controlsService }) =>
      e.reply(APP_EVENTS_RESPONSE.CONTROL, {
        success: false,
        error,
        action,
        done: false,
        paused: controlsService.isPaused(),
      }),
  },
);

events.push(
  APP_EVENTS.GET_CONTROLS,
  ({ controlsService }, e) => {
    e.reply(APP_EVENTS_RESPONSE.CONTROLS, {
      paused: controlsService.isPaused(),
    });
  },
  { notify: false },
);

// Settings saves them as they're recorded: no notice on success
events.push(
  APP_EVENTS.SET_SHORTCUTS,
  async (handler, e, { shortcuts }) => {
    const { storeManagerService: store, notifier } = handler;
    // The recorder suspended them, and nothing registers while suspended
    globalShortcut.setSuspended(false);
    // Throws on shortcuts the schema refuses, keeping the stored ones
    const saved = await store.updateShortcuts(shortcuts);
    const taken = applyStoredShortcuts(handler);
    replySettings(e, store);
    if (!saved) throw saveFailure();
    e.reply(APP_EVENTS_RESPONSE.SET_SHORTCUTS, { success: true, taken });
    warnTaken(notifier, taken);
  },
  {
    failure: {
      code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
      message: "main.failure.setShortcuts",
    },
    onError: (e, error) =>
      e.reply(APP_EVENTS_RESPONSE.SET_SHORTCUTS, {
        success: false,
        error,
        taken: [],
      }),
  },
);

// While a shortcut field records, so its keys reach the field
events.push(
  APP_EVENTS.SUSPEND_SHORTCUTS,
  (_handler, _e, { suspended }) => {
    globalShortcut.setSuspended(suspended);
  },
  { notify: false },
);

export default events;
