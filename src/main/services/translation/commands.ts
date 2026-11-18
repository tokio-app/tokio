import { TOKIO_EVENTS } from "@/common/types";
import { reactsToEvents, triggersOf } from "@/common/util";
import type { AppServices } from "@/types";
import type { ChatCommands } from ".";

/**
 * What Chat translation leaves as typed, read only for a message it would
 * translate: the active profile's TTS trigger and enabled music commands, the
 * keywords of chat triggers that are on, and the overlays' commands.
 */
export async function chatCommands({
  storeManagerService: store,
  overlayService: overlays,
}: {
  storeManagerService: Pick<
    AppServices["storeManagerService"],
    "getProfileData" | "getStudio"
  >;
  overlayService: Pick<AppServices["overlayService"], "chatCommands">;
}): Promise<ChatCommands> {
  const profile = await store.getProfileData();
  const studio = store
    .getStudio()
    .flatMap((overlay) =>
      overlay.items.flatMap((item) =>
        item.kind === "group" ? [item, ...item.elements] : [item],
      ),
    )
    .filter(reactsToEvents);
  // matchesTrigger reads a keyword only on Chat triggers. A studio item
  // reacts to each of its triggers.
  const keywords = [
    ...(profile?.alerts.items ?? [])
      .filter((alert) => alert.enabled)
      .map((alert) => alert.trigger),
    ...(profile?.games.actions ?? [])
      .filter((action) => action.enabled)
      .map((action) => action.trigger),
    ...studio.flatMap(triggersOf),
  ].flatMap((trigger) =>
    trigger.type === TOKIO_EVENTS.CHAT ? [trigger.keyword] : [],
  );
  const trigger = profile?.tts.format.trigger;
  // The timer reacts to its keyword only while chat adds time
  const timer = profile?.timer.settings;
  const timerKeyword =
    timer && timer.seconds.chat > 0 ? timer.chat.keyword : "";
  return {
    trigger: trigger && trigger.mode !== "any" ? trigger.value : "",
    commands: [
      ...Object.values(profile?.music.controls ?? {})
        .filter((control) => control.enabled)
        .map((control) => control.command),
      ...overlays.chatCommands(),
    ],
    keywords: [...keywords, timerKeyword].filter((k) => k.trim()),
  };
}
