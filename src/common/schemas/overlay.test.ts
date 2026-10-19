import { describe, expect, it } from "vitest";
import { CustomGift } from "../types/overlay";
import { getOverlayConfig, OverlayConfig, resetOverlayConfig } from "./overlay";

const GIFTS: CustomGift[] = [
  { value: 1, label: "Rose", img: "rose.png", coins: 1 },
  { value: 2, label: "Lion", img: "lion.png", coins: 29999 },
  { value: 3, label: "Heart", img: "heart.png", coins: 5 },
];

function makeConfig(): OverlayConfig {
  return {
    sections: [
      { id: "general", name: "General" },
      { id: "style", name: "Style" },
    ],
    fields: [
      {
        id: "title",
        name: "Title",
        section: "general",
        type: "input",
        attributes: {
          mode: "text",
          placeholder: "Type here",
          value: "changed",
          default: "initial",
        },
      },
      {
        id: "mode",
        name: "Mode",
        section: "general",
        type: "dropdown",
        attributes: {
          multiple: true,
          searchable: true,
          value: ["a"],
          default: ["a", "b"],
          options: [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
          ],
        },
      },
      {
        id: "tint",
        name: "Tint",
        section: "style",
        type: "color",
        attributes: { value: "ff0000", default: "00ff00" },
      },
      {
        id: "show",
        name: "Show",
        section: "style",
        type: "check",
        attributes: { value: false, default: true },
      },
      {
        id: "sound",
        name: "Sound",
        section: "style",
        type: "toggle",
        attributes: { value: true, default: false },
      },
      {
        id: "gifts",
        name: "Gifts",
        section: "general",
        type: "gifts",
        attributes: { multiple: true, value: [1], default: [2, 3] },
      },
      {
        id: "size",
        name: "Size",
        section: "style",
        type: "slider",
        attributes: { value: 80, default: 50, min: 0, max: 100 },
      },
    ],
  };
}

describe("resetOverlayConfig", () => {
  it("sets every value back to its default and keeps the rest", () => {
    const config = makeConfig();
    const reset = resetOverlayConfig(config);

    expect(reset.sections).toEqual(config.sections);
    expect(reset.fields).toHaveLength(config.fields.length);

    reset.fields.forEach((field, i) => {
      const original = config.fields[i];
      expect(field.attributes.value).toEqual(field.attributes.default);
      expect({
        ...field,
        attributes: { ...field.attributes, value: null },
      }).toEqual({
        ...original,
        attributes: { ...original.attributes, value: null },
      });
    });
  });

  it("copies array defaults and does not mutate the input", () => {
    const config = makeConfig();
    const snapshot = structuredClone(config);
    const reset = resetOverlayConfig(config);

    expect(config).toEqual(snapshot);

    for (const field of reset.fields) {
      const { value, default: fallback } = field.attributes;
      if (Array.isArray(fallback)) {
        expect(value).toEqual(fallback);
        expect(value).not.toBe(fallback);
      }
    }
  });
});

describe("getOverlayConfig", () => {
  it("keys each field's value by id, with colors prefixed", () => {
    expect(getOverlayConfig(makeConfig(), "value", GIFTS)).toEqual({
      title: "changed",
      mode: ["a"],
      tint: "#ff0000",
      show: false,
      sound: true,
      gifts: [GIFTS[0]],
      size: 80,
    });
  });

  it("reads the defaults in default mode", () => {
    expect(getOverlayConfig(makeConfig(), "default", GIFTS)).toMatchObject({
      title: "initial",
      tint: "#00ff00",
      gifts: [GIFTS[1], GIFTS[2]],
      size: 50,
    });
  });

  it("gives one gift for a single gift field", () => {
    const config = makeConfig();
    config.fields[5] = {
      id: "gifts",
      name: "Gift",
      section: "general",
      type: "gifts",
      attributes: { multiple: false, value: 3, default: 1 },
    };

    expect(getOverlayConfig(config, "value", GIFTS).gifts).toEqual(GIFTS[2]);
  });

  it("drops unknown gifts, and gives none without the gift list", () => {
    const config = makeConfig();
    config.fields[5].attributes.value = [1, 99];

    expect(getOverlayConfig(config, "value", GIFTS).gifts).toEqual([GIFTS[0]]);
    expect(getOverlayConfig(config, "value", null).gifts).toEqual([]);
  });
});
