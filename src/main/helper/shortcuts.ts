import { listOf } from "@/common/i18n";
import type { Shortcuts } from "@/common/schemas";
import {
  APP_EVENTS,
  CONTROL_ACTIONS,
  ControlAction,
  FEEDBACK_CODES,
} from "@/common/types";
import type { Notifier } from "@/helper/feedback";
import { language, t } from "@/helper/i18n";
import type { AppHandlerVariables } from "@/types";
import { globalShortcut } from "electron";

/**
 * Registers each shortcut that's set, in place of the ones before. Returns
 * the actions whose shortcut doesn't fire: another app holds it, or it's one
 * Electron can't read.
 */
export function applyShortcuts(
  shortcuts: Shortcuts,
  fire: (action: ControlAction) => void,
): ControlAction[] {
  globalShortcut.unregisterAll();
  return CONTROL_ACTIONS.filter((action) => {
    const accelerator = shortcuts[action];
    if (!accelerator) return false;
    try {
      return !globalShortcut.register(accelerator, () => fire(action));
    } catch {
      return true;
    }
  });
}

/** Applies the stored shortcuts, each running its control as a request. */
export const applyStoredShortcuts = ({
  storeManagerService,
  invoke,
}: AppHandlerVariables) =>
  applyShortcuts(
    storeManagerService.getSettings().shortcuts,
    (action) => void invoke(APP_EVENTS.CONTROL, { action }),
  );

/** Says which shortcuts another app holds, once a while for the same ones. */
export function warnTaken(notifier: Notifier, taken: ControlAction[]) {
  if (taken.length === 0) return;
  notifier.warn(
    "system",
    FEEDBACK_CODES.SHORTCUT_TAKEN,
    t("main.shortcuts.taken", {
      count: taken.length,
      actions: listOf(
        language(),
        taken.map((action) => t(`main.shortcuts.${action}`)),
      ),
      settings: t("nav.settings"),
      // The section's own title, so the two can't drift apart
      section: t("settings.shortcuts.title"),
    }),
    { key: `shortcuts:${taken.join(",")}` },
  );
}
