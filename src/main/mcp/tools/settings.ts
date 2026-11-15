import { APP_EVENTS } from "@/common/types";
import { z } from "zod";
import { invokeOk, ok, pushSettings } from "../common";
import {
  defineSection,
  type Kinds,
  type Sections,
  type ToolDef,
} from "../defs";

export const sections: Sections = {
  features: defineSection({
    schema: z
      .object({ tts: z.boolean(), music: z.boolean(), alerts: z.boolean() })
      .strict(),
    read: ({ storeManagerService }) => {
      const { tts, music, alerts } = storeManagerService.getActiveFeatures();
      return { tts, music, alerts };
    },
    write: async (handler, values) => {
      const { error } = await invokeOk(handler, APP_EVENTS.ACTIVE_FEATURES, {
        tts: values.tts,
        music: values.music,
        alerts: values.alerts,
      });
      // Its handler replies nothing. Also after a failed save: the window
      // shows what main holds.
      pushSettings(handler);
      return error ?? ok("Saved.");
    },
    notes:
      "Home's switches, the same for every profile. Turning one off stops what it's playing: tts the chat messages being read, alerts the alerts, music the song requests waiting.",
  }),
};
export const kinds: Kinds = {};
export const tools: ToolDef<any>[] = [];
