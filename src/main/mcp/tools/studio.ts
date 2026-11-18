import { previewStudioOverlay } from "@/helper/studioPreview";
import { z } from "zod";
import { fail } from "../common";
import {
  defineTool,
  type Kinds,
  READ,
  type Sections,
  type ToolDef,
} from "../defs";

export const sections: Sections = {};

export const kinds: Kinds = {};

const PreviewInput = z
  .object({
    id: z.string().describe("The id of a studio_overlay (from list)."),
    scale: z
      .number()
      .min(0.25)
      .max(1)
      .optional()
      .describe(
        "The picture's size as a fraction of the canvas, 0.5 if left out.",
      ),
  })
  .strict();

const preview = defineTool({
  name: "preview_studio_overlay",
  title: "Preview a studio overlay",
  description:
    "A PNG of an Overlay Studio overlay as its browser source draws it, to check and fix its layout. It shows the overlay as saved, not unsaved changes open in the editor. Elements and groups that wait for an event are shown, texts and pictures filled with the same sample values Test uses, loops held at rest, cameras blank, and embedded overlays as their own idle pages. The canvas (1080x1920 portrait or 1920x1080 landscape) is scaled by `scale`; gray shows where the overlay is transparent. The text block gives the picture's size and how many pictures, videos or embeds failed to load.",
  input: PreviewInput,
  // Sample pictures load from the web
  annotations: { ...READ, openWorldHint: true },
  run: async (handler, { id, scale = 0.5 }) => {
    const overlay = handler.storeManagerService
      .getStudio()
      .find((o) => o.id === id);
    if (!overlay) return fail(`No studio overlay ${id}.`);
    // A failure or timeout throws: the registry logs it and fails the call
    const shot = await previewStudioOverlay(handler, overlay, scale);
    return {
      content: [
        {
          type: "image",
          data: shot.png.toString("base64"),
          mimeType: "image/png",
        },
        {
          type: "text",
          text: JSON.stringify({
            id,
            width: shot.width,
            height: shot.height,
            scale,
            failedToLoad: shot.failed,
          }),
        },
      ],
    };
  },
});

export const tools: ToolDef[] = [preview];
