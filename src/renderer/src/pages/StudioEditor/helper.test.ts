import { translate } from "@/common/i18n";
import { StudioLayer, StudioLayerSchema } from "@/common/schemas";
import { EMOTE_TRIGGER, TOKIO_EVENTS } from "@/common/types";
import { newStudioLayer } from "@/common/util";
import { gift } from "@test/fixtures";
import { describe, expect, it } from "vitest";
import {
  layerName,
  moveLayer,
  roundBox,
  sampleReact,
  Samples,
  sourceOf,
  sourceValue,
  whenText,
} from "./helper";

const t = (
  key: Parameters<typeof translate>[1],
  params?: Record<string, string>,
) => translate("en", key, params);
const context = {
  gifts: [gift(5655, "Rose")],
  emotes: [{ value: "e1", label: "Emote 1", img: "https://x/e1.png" }],
  label: () => "Gift jar",
  t,
};
const layer = <K extends StudioLayer["kind"]>(
  kind: K,
  patch: Partial<Extract<StudioLayer, { kind: K }>> = {},
) => StudioLayerSchema.parse({ ...newStudioLayer(kind, "portrait"), ...patch });

describe("layerName", () => {
  it("names a layer by what it shows", () => {
    expect(
      layerName(layer("text", { text: " Thanks\nfor the follow" }), context),
    ).toBe("Thanks");
    expect(layerName(layer("media", { name: "Party" }), context)).toBe("Party");
    expect(layerName(layer("gift", { gift: 5655 }), context)).toBe("Rose");
    expect(
      layerName(
        layer("emote", { emote: { id: "e1", image: "https://x/e1.png" } }),
        context,
      ),
    ).toBe("Emote 1");
    expect(
      layerName(
        layer("overlay", { source: { type: "games", column: null } }),
        context,
      ),
    ).toBe("Gift jar");
  });

  it("falls back to its kind", () => {
    expect(layerName(layer("text"), context)).toBe("Text");
    expect(layerName(layer("gift", { gift: 1 }), context)).toBe("Gift");
    expect(layerName(layer("shape"), context)).toBe("Shape");
    expect(layerName(layer("viewer"), context)).toBe("Viewer's picture");
    expect(layerName(layer("overlay"), context)).toBe("Overlay");
  });
});

describe("whenText", () => {
  it("says when a layer shows, with its trigger", () => {
    expect(whenText(layer("shape"), t)).toBe("always on screen");
    expect(whenText(layer("viewer"), t)).toBe("shows on Follow");
    expect(
      whenText(
        layer("shape", {
          when: "animate",
          trigger: {
            ...newStudioLayer("shape", "portrait").trigger,
            type: TOKIO_EVENTS.GIFT,
          },
        }),
        t,
      ),
    ).toBe("moves on Gift");
  });
});

describe("sourceValue and sourceOf", () => {
  it("round-trips every source", () => {
    for (const source of [
      { type: "installed", id: "gift-jar" },
      { type: "alert", id: "a:1" },
      { type: "timer" },
      { type: "games", column: null },
      { type: "games", column: 2 },
    ] as const) {
      expect(sourceOf(sourceValue(source)!)).toEqual(source);
    }
    expect(sourceValue(null)).toBeUndefined();
  });
});

describe("moveLayer", () => {
  it("moves one item, and nothing out of range", () => {
    expect(moveLayer(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveLayer(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    const same = ["a", "b"];
    expect(moveLayer(same, 1, 2)).toBe(same);
    expect(moveLayer(same, 0, -1)).toBe(same);
  });
});

describe("roundBox", () => {
  it("keeps whole px and a size of at least 1", () => {
    expect(roundBox({ x: 1.4, y: -2.6, width: 0.2, height: -40 })).toEqual({
      x: 1,
      y: -3,
      width: 1,
      height: 1,
    });
  });
});

describe("Samples", () => {
  it("makes each trigger's sample once, an emote's from chat", () => {
    const samples = new Samples();

    expect(samples.of(TOKIO_EVENTS.FOLLOW)).toBe(
      samples.of(TOKIO_EVENTS.FOLLOW),
    );
    expect(samples.of(EMOTE_TRIGGER)).toHaveProperty("comment");
  });

  it("plays a text with its trigger's values and a viewer with its picture", () => {
    const samples = new Samples();
    const text = layer("text", { text: "Hi {username}", when: "event" });
    const viewer = layer("viewer");
    const follow = samples.of(TOKIO_EVENTS.FOLLOW);
    const username =
      typeof follow === "object" && follow && "user" in follow
        ? follow.user.username
        : "";

    expect(username).not.toBe("");
    expect(sampleReact(text, samples, "en")).toEqual({
      layer: text.id,
      text: `Hi ${username}`,
    });
    expect(sampleReact(viewer, samples, "en")).toMatchObject({
      layer: viewer.id,
      name: username,
    });
    expect(sampleReact(layer("shape"), samples, "en")).toEqual({
      layer: expect.any(String),
    });
  });
});
