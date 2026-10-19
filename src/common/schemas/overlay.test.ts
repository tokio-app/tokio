import { describe, expect, it } from "vitest";
import { CustomGift } from "../types/overlay";
import {
  getOverlayConfig,
  mergeOverlayConfig,
  OverlayConfig,
  resetOverlayConfig,
} from "./overlay";

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

describe("mergeOverlayConfig", () => {
  // A newer version as it ships, with its defaults as values.
  const newer = () => resetOverlayConfig(makeConfig());

  it("keeps the saved values", () => {
    expect(mergeOverlayConfig(newer(), makeConfig())).toEqual(makeConfig());
  });

  it("follows the new version's sections and fields", () => {
    const next = newer();
    next.sections.push({ id: "extra", name: "Extra" });
    next.fields.push({
      id: "label",
      name: "Label",
      section: "extra",
      type: "input",
      attributes: { mode: "text", value: "Hi", default: "Hi" },
    });
    // Drops the color
    next.fields.splice(2, 1);

    const merged = mergeOverlayConfig(next, makeConfig());

    expect(merged.sections).toEqual(next.sections);
    expect(merged.fields.map((f) => f.id)).toEqual(
      next.fields.map((f) => f.id),
    );
    expect(merged.fields.at(-1)?.attributes.value).toBe("Hi");
    expect(merged.fields[0].attributes.value).toBe("changed");
  });

  it("leaves out values that no longer fit", () => {
    const next = newer();
    next.fields[0] = {
      id: "title",
      name: "Title",
      section: "general",
      type: "input",
      attributes: { mode: "number", value: 5, default: 5 },
    };
    next.fields[1] = {
      id: "mode",
      name: "Mode",
      section: "general",
      type: "dropdown",
      attributes: {
        multiple: true,
        searchable: false,
        value: ["b"],
        default: ["b"],
        options: [
          { value: "b", label: "B" },
          { value: "c", label: "C" },
        ],
      },
    };
    next.fields[3] = {
      id: "show",
      name: "Show",
      section: "style",
      type: "toggle",
      attributes: { value: true, default: true },
    };
    next.fields[6] = {
      id: "size",
      name: "Size",
      section: "style",
      type: "slider",
      attributes: { value: 20, default: 20, min: 0, max: 40 },
    };

    const merged = mergeOverlayConfig(next, makeConfig());

    // A number now, an option that's gone, another type, out of range
    for (const i of [0, 1, 3, 6])
      expect(merged.fields[i]).toEqual(next.fields[i]);
    expect(merged.fields[2].attributes.value).toBe("ff0000");
  });

  it("doesn't change its inputs", () => {
    const next = newer();
    const saved = makeConfig();
    const snapshot = structuredClone({ next, saved });

    const merged = mergeOverlayConfig(next, saved);

    expect({ next, saved }).toEqual(snapshot);
    expect(merged.fields[1].attributes.value).not.toBe(
      saved.fields[1].attributes.value,
    );
  });
});
