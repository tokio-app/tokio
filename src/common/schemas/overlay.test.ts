import { describe, expect, it } from "vitest";
import { CustomGift } from "../types/overlay";
import {
  getOverlayConfig,
  mergeOverlayConfig,
  OverlayConfig,
  OverlayConfigSchema,
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

// A font and a table of social links, whose rows name a gift
function makeTable(): OverlayConfig {
  return {
    sections: [{ id: "general", name: "General" }],
    fields: [
      {
        id: "font",
        name: "Font",
        section: "general",
        type: "font",
        attributes: { value: "Comic Sans MS", default: "" },
      },
      {
        id: "socials",
        name: "Social links",
        section: "general",
        type: "table",
        attributes: {
          max: 3,
          columns: [
            {
              id: "platform",
              name: "Platform",
              type: "dropdown",
              attributes: {
                multiple: false,
                searchable: false,
                default: "facebook",
                options: [
                  { value: "facebook", label: "Facebook" },
                  { value: "instagram", label: "Instagram" },
                ],
              },
            },
            {
              id: "username",
              name: "Username",
              type: "input",
              attributes: { mode: "text", default: "" },
            },
            {
              id: "color",
              name: "Icon color",
              type: "color",
              attributes: { default: "ffffff" },
            },
            {
              id: "gift",
              name: "Gift",
              type: "gifts",
              attributes: { multiple: false, default: 1 },
            },
          ],
          value: [
            {
              platform: "instagram",
              username: "@tokio",
              color: "ff0000",
              gift: 2,
            },
            { platform: "facebook", username: "", color: "ffffff", gift: 3 },
          ],
          default: [
            { platform: "facebook", username: "", color: "ffffff", gift: 1 },
          ],
        },
      },
    ],
  };
}

// The attributes of makeTable's table
function socials(config: OverlayConfig) {
  const field = config.fields[1];
  if (field.type !== "table") throw new Error("Not a table");
  return field.attributes;
}

describe("OverlayConfigSchema", () => {
  const issues = (config: OverlayConfig) =>
    OverlayConfigSchema.safeParse(config).error?.issues.map((i) => i.path);

  it("accepts a valid config", () => {
    expect(issues(makeConfig())).toBeUndefined();
  });

  it("accepts fonts and tables", () => {
    expect(issues(makeTable())).toBeUndefined();
  });

  it("refuses a font name over 60 characters", () => {
    const config = makeTable();
    config.fields[0].attributes.value = "a".repeat(61);

    expect(issues(config)).toEqual([["fields", 0, "attributes", "value"]]);
  });

  it("points at a table's column with the id of another", () => {
    const config = makeTable();
    socials(config).columns[2].id = "platform";

    expect(issues(config)).toContainEqual([
      "fields",
      1,
      "attributes",
      "columns",
      2,
      "id",
    ]);
  });

  it("refuses more rows than the table's max", () => {
    const config = makeTable();
    const table = socials(config);
    table.max = 1;

    expect(issues(config)).toEqual([["fields", 1, "attributes", "value"]]);

    table.default.push(...table.value);
    expect(issues(config)).toEqual([
      ["fields", 1, "attributes", "value"],
      ["fields", 1, "attributes", "default"],
    ]);
  });

  it("points at the rows that don't fit the columns", () => {
    const config = makeTable();
    const table = socials(config);
    const row = {
      platform: "facebook",
      username: "",
      color: "ffffff",
      gift: 1,
    };
    table.value = [
      // A missing cell, an extra one, and a cell of another kind
      { platform: "facebook", color: "ffffff", gift: 1 },
      { ...row, extra: "x" },
      { ...row, username: true },
    ];
    table.default = [{ ...row, color: "red" }];

    expect(issues(config)).toEqual([
      ["fields", 1, "attributes", "value", 0],
      ["fields", 1, "attributes", "value", 1],
      ["fields", 1, "attributes", "value", 2],
      ["fields", 1, "attributes", "default", 0],
    ]);
  });

  it("points at the field whose section doesn't exist", () => {
    const config = makeConfig();
    config.fields[2].section = "missing";

    expect(issues(config)).toEqual([["fields", 2, "section"]]);
  });

  it("points at a field with the id of another", () => {
    const config = makeConfig();
    config.fields[3].id = "title";

    expect(issues(config)).toEqual([["fields", 3, "id"]]);
  });
});

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

  it("sets a table back to a copy of its default rows", () => {
    const config = makeTable();
    const table = socials(resetOverlayConfig(config));

    expect(table.value).toEqual(socials(config).default);
    expect(table.value).not.toBe(table.default);
    expect(table.value[0]).not.toBe(table.default[0]);
  });
});

describe("getOverlayConfig", () => {
  it("keys each field's value by id, with colors prefixed", () => {
    expect(getOverlayConfig(makeConfig(), GIFTS)).toEqual({
      title: "changed",
      mode: ["a"],
      tint: "#ff0000",
      show: false,
      sound: true,
      gifts: [GIFTS[0]],
      size: 80,
    });
  });

  it("gives one gift for a single gift field, or none without the list", () => {
    const config = makeConfig();
    config.fields[5] = {
      id: "gifts",
      name: "Gift",
      section: "general",
      type: "gifts",
      attributes: { multiple: false, value: 3, default: 1 },
    };

    expect(getOverlayConfig(config, GIFTS).gifts).toEqual(GIFTS[2]);
    expect(getOverlayConfig(config, null).gifts).toBeUndefined();
  });

  it("drops unknown gifts, and gives none without the gift list", () => {
    const config = makeConfig();
    config.fields[5].attributes.value = [1, 99];

    expect(getOverlayConfig(config, GIFTS).gifts).toEqual([GIFTS[0]]);
    expect(getOverlayConfig(config, null).gifts).toEqual([]);
  });

  it("gives a font's name and a table's rows, each cell read like a field", () => {
    expect(getOverlayConfig(makeTable(), GIFTS)).toEqual({
      font: "Comic Sans MS",
      socials: [
        {
          platform: "instagram",
          username: "@tokio",
          color: "#ff0000",
          gift: GIFTS[1],
        },
        {
          platform: "facebook",
          username: "",
          color: "#ffffff",
          gift: GIFTS[2],
        },
      ],
    });
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

  it("keeps a table's saved rows", () => {
    expect(
      mergeOverlayConfig(resetOverlayConfig(makeTable()), makeTable()),
    ).toEqual(makeTable());
  });

  it("keeps a table the streamer emptied", () => {
    const saved = makeTable();
    socials(saved).value = [];

    const merged = mergeOverlayConfig(resetOverlayConfig(makeTable()), saved);

    expect(socials(merged).value).toEqual([]);
  });

  it("fits a table's saved rows to the new version's columns", () => {
    const next = resetOverlayConfig(makeTable());
    const table = socials(next);
    table.max = 1;
    table.columns = [
      // Instagram is gone
      {
        id: "platform",
        name: "Platform",
        type: "dropdown",
        attributes: {
          multiple: false,
          searchable: false,
          default: "facebook",
          options: [
            { value: "facebook", label: "Facebook" },
            { value: "tiktok", label: "TikTok" },
          ],
        },
      },
      // Another type, the gift's column is gone, and a new column
      {
        id: "username",
        name: "Username",
        type: "check",
        attributes: { default: false },
      },
      {
        id: "color",
        name: "Icon color",
        type: "color",
        attributes: { default: "ffffff" },
      },
      {
        id: "label",
        name: "Label",
        type: "input",
        attributes: { mode: "text", default: "Hi" },
      },
    ];
    table.default = [
      { platform: "facebook", username: false, color: "ffffff", label: "Hi" },
    ];

    const merged = mergeOverlayConfig(next, makeTable());

    // The first row alone, as the new max is 1
    expect(socials(merged).value).toEqual([
      { platform: "facebook", username: false, color: "ff0000", label: "Hi" },
    ]);
    expect(OverlayConfigSchema.safeParse(merged).success).toBe(true);
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
