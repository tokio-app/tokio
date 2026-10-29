import { z } from "zod";
import { CustomGift, OverlayConfigRedux } from "../types/overlay";
import { FONT_MAX_LENGTH } from "./timer";

const SectionSchema = z.object({
  name: z.string(),
  id: z.string(),
});

const BaseSetting = {
  name: z.string(),
  id: z.string(),
  section: z.string(),
};

const InputValue = z.union([z.string().default(""), z.number().default(0)]);

const InputSetting = z.object({
  ...BaseSetting,
  type: z.literal("input"),
  attributes: z.object({
    mode: z.enum(["text", "number"]),
    placeholder: z.string().optional(),
    value: InputValue,
    default: InputValue,
  }),
});

const DropValue = z.union([
  z.string(),
  z.array(z.string()),
  z.number(),
  z.array(z.number()),
]);

const DropdownSetting = z.object({
  ...BaseSetting,
  type: z.literal("dropdown"),
  attributes: z.object({
    multiple: z.boolean().default(false),
    searchable: z.boolean().default(false),
    value: DropValue,
    default: DropValue,
    options: z.array(
      z.object({
        value: z.union([z.string(), z.number()]),
        label: z.union([z.string(), z.number()]),
        img: z.string().optional(),
      }),
    ),
  }),
});

const ColorValue = z
  .string()
  .regex(/^[0-9a-f]{6}([0-9a-f]{2})?$/i, "Must be a 6 or 8-character hex code");

const ColorSetting = z.object({
  ...BaseSetting,
  type: z.literal("color"),
  attributes: z.object({
    value: ColorValue,
    default: ColorValue,
  }),
});

const CheckSetting = z.object({
  ...BaseSetting,
  type: z.literal("check"),
  attributes: z.object({
    value: z.boolean(),
    default: z.boolean(),
  }),
});

const ToggleSetting = z.object({
  ...BaseSetting,
  type: z.literal("toggle"),
  attributes: z.object({
    value: z.boolean(),
    default: z.boolean(),
  }),
});

const GiftsSetting = z.object({
  ...BaseSetting,
  type: z.literal("gifts"),
  attributes: z.object({
    multiple: z.boolean().default(false),
    value: z.union([z.number(), z.array(z.number())]),
    default: z.union([z.number(), z.array(z.number())]),
  }),
});

const SliderSetting = z.object({
  ...BaseSetting,
  type: z.literal("slider"),
  attributes: z.object({
    value: z.number(),
    default: z.number(),
    min: z.number(),
    max: z.number(),
  }),
});

// A font's name, "" for the overlay's own font
const FontValue = z.string().max(FONT_MAX_LENGTH);

const FontSetting = z.object({
  ...BaseSetting,
  type: z.literal("font"),
  attributes: z.object({
    value: FontValue,
    default: FontValue,
  }),
});

// A table's column: a field without its section and value, whose default
// fills the cell of a new row. A slider has no room for its number in a cell.
const ColumnSchema = z.discriminatedUnion("type", [
  InputSetting.omit({ section: true }).extend({
    attributes: InputSetting.shape.attributes.omit({ value: true }),
  }),
  DropdownSetting.omit({ section: true }).extend({
    attributes: DropdownSetting.shape.attributes.omit({ value: true }),
  }),
  ColorSetting.omit({ section: true }).extend({
    attributes: ColorSetting.shape.attributes.omit({ value: true }),
  }),
  CheckSetting.omit({ section: true }).extend({
    attributes: CheckSetting.shape.attributes.omit({ value: true }),
  }),
  ToggleSetting.omit({ section: true }).extend({
    attributes: ToggleSetting.shape.attributes.omit({ value: true }),
  }),
  GiftsSetting.omit({ section: true }).extend({
    attributes: GiftsSetting.shape.attributes.omit({ value: true }),
  }),
  FontSetting.omit({ section: true }).extend({
    attributes: FontSetting.shape.attributes.omit({ value: true }),
  }),
]);

// Each row's cells by column id. The config's check fits them to the columns.
const Rows = z.array(
  z.record(
    z.string(),
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.array(z.string()),
      z.array(z.number()),
    ]),
  ),
);

const TableSetting = z.object({
  ...BaseSetting,
  type: z.literal("table"),
  attributes: z.object({
    columns: z.array(ColumnSchema).min(1),
    // The most rows the streamer can add, no limit without it
    max: z.number().int().min(1).optional(),
    value: Rows,
    default: Rows,
  }),
});

const FieldsSchema = z.discriminatedUnion("type", [
  InputSetting,
  DropdownSetting,
  ColorSetting,
  CheckSetting,
  ToggleSetting,
  GiftsSetting,
  SliderSetting,
  FontSetting,
  TableSetting,
]);

export const OverlayConfigSchema = z
  .object({
    sections: z.array(SectionSchema),
    fields: z.array(FieldsSchema),
  })
  .superRefine((data, ctx) => {
    const seenSectionIds = new Set<string>();
    const seenFieldIds = new Set<string>();

    data.sections.forEach((section, index) => {
      if (seenSectionIds.has(section.id)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate section ID found: '${section.id}'. Each section must have a unique ID.`,
          path: ["sections", index, "id"],
        });
      }
      seenSectionIds.add(section.id);
    });

    data.fields.forEach((field, index) => {
      if (!seenSectionIds.has(field.section)) {
        ctx.addIssue({
          code: "custom",
          message: `Invalid section: '${field.section}' is not defined in the sections array.`,
          path: ["fields", index, "section"],
        });
      }

      if (seenFieldIds.has(field.id)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate field ID found: '${field.id}'. Each field must have a unique ID.`,
          path: ["fields", index, "id"],
        });
      }

      seenFieldIds.add(field.id);

      if (field.type === "table") checkTable(field, index, ctx);
    });
  });

export type OverlayConfig = z.infer<typeof OverlayConfigSchema>;
export type OverlayConfigField = z.infer<typeof FieldsSchema>;
export type OverlayConfigTable = Extract<OverlayConfigField, { type: "table" }>;
// A field of one value, which is what each cell of a table is too
export type OverlayConfigLeaf = Exclude<OverlayConfigField, { type: "table" }>;
export type OverlayConfigColumn = z.infer<typeof ColumnSchema>;
export type OverlayConfigRow = z.infer<typeof Rows>[number];

// A table's column ids are its own, it has no more rows than its max, and each
// row fits its columns.
function checkTable(
  { attributes }: OverlayConfigTable,
  index: number,
  ctx: z.RefinementCtx,
) {
  const path = ["fields", index, "attributes"];
  const seenColumnIds = new Set<string>();

  attributes.columns.forEach((column, c) => {
    if (seenColumnIds.has(column.id)) {
      ctx.addIssue({
        code: "custom",
        message: `Duplicate column ID found: '${column.id}'. Each column of a table must have a unique ID.`,
        path: [...path, "columns", c, "id"],
      });
    }
    seenColumnIds.add(column.id);
  });

  for (const key of ["value", "default"] as const) {
    const rows = attributes[key];
    if (attributes.max !== undefined && rows.length > attributes.max) {
      ctx.addIssue({
        code: "custom",
        message: `Too many rows: ${rows.length}, but the table allows ${attributes.max}.`,
        path: [...path, key],
      });
    }

    rows.forEach((row, r) => {
      if (!fitsColumns(row, attributes.columns)) {
        ctx.addIssue({
          code: "custom",
          message:
            "Invalid row: it needs a value of its column's kind for each column, keyed by the column's ID, and nothing else.",
          path: [...path, key, r],
        });
      }
    });
  }
}

// Whether a row has a cell for each column, each one a value the column could
// have as its default, and no other cell
function fitsColumns(
  row: OverlayConfigRow,
  columns: OverlayConfigColumn[],
): boolean {
  return (
    Object.keys(row).length === columns.length &&
    columns.every(
      (column) =>
        Object.hasOwn(row, column.id) &&
        ColumnSchema.safeParse({
          ...column,
          attributes: { ...column.attributes, default: row[column.id] },
        }).success,
    )
  );
}

/** A table's cell, as a field of its column's type. */
export function cellField(
  column: OverlayConfigColumn,
  value: unknown,
): OverlayConfigLeaf {
  const field = {
    ...column,
    section: "",
    attributes: { ...column.attributes, value },
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the config's check fits each cell to its column
  return field as OverlayConfigLeaf;
}

/** The config with every field's value set back to its default. */
export function resetOverlayConfig(config: OverlayConfig): OverlayConfig {
  const reset = structuredClone(config);
  for (const { attributes } of reset.fields) {
    // Each field's value has the same type as its default.
    Object.assign(attributes, { value: structuredClone(attributes.default) });
  }
  return reset;
}

/**
 * A new version's config with the saved values that still fit it. A value is
 * kept from a field with the same id and type when it's of the same kind as
 * the new default, among the options (dropdowns) and within the range
 * (sliders). Other fields keep the new version's values. A table keeps its
 * saved rows, up to its max, each cell kept the same way from a column with
 * the same id and type, and the others set to their column's default.
 */
export function mergeOverlayConfig(
  next: OverlayConfig,
  saved: OverlayConfig,
): OverlayConfig {
  const merged = structuredClone(next);
  for (const field of merged.fields) {
    const old = saved.fields.find(
      (f) => f.id === field.id && f.type === field.type,
    );
    if (!old) continue;

    // fits would keep any list of rows
    if (field.type === "table") {
      if (old.type === "table") field.attributes.value = mergeRows(field, old);
      continue;
    }

    if (fits(field, old.attributes.value)) {
      // fits checked it against the field's default.
      Object.assign(field.attributes, {
        value: structuredClone(old.attributes.value),
      });
    }
  }
  return merged;
}

// The saved rows in the new version's columns
function mergeRows(
  table: OverlayConfigTable,
  old: OverlayConfigTable,
): OverlayConfigRow[] {
  const { columns, max } = table.attributes;
  return old.attributes.value.slice(0, max).map((row) =>
    Object.fromEntries(
      columns.map((column) => {
        const kept =
          old.attributes.columns.some(
            (c) => c.id === column.id && c.type === column.type,
          ) &&
          Object.hasOwn(row, column.id) &&
          fits(column, row[column.id]);
        return [
          column.id,
          structuredClone(kept ? row[column.id] : column.attributes.default),
        ];
      }),
    ),
  );
}

// Whether a saved value can be the field's or the cell's value.
function fits(
  field: OverlayConfigLeaf | OverlayConfigColumn,
  value: unknown,
): boolean {
  const fallback: unknown = field.attributes.default;
  if (Array.isArray(fallback) !== Array.isArray(value)) return false;
  if (!Array.isArray(value) && typeof value !== typeof fallback) return false;

  if (field.type === "dropdown") {
    const options = new Set(field.attributes.options.map((o) => o.value));
    const values: unknown[] = Array.isArray(value) ? value : [value];
    return values.every(
      (v) => (typeof v === "string" || typeof v === "number") && options.has(v),
    );
  }
  if (field.type === "slider") {
    return (
      typeof value === "number" &&
      value >= field.attributes.min &&
      value <= field.attributes.max
    );
  }
  return true;
}

/**
 * The settings an overlay reads, keyed by field id: each field's value,
 * colors with their `#` and gift ids resolved to the gifts. A table gives its
 * rows, each cell read the same way.
 */
export function getOverlayConfig(
  data: OverlayConfig,
  gifts?: CustomGift[] | null,
): OverlayConfigRedux {
  const extracted: OverlayConfigRedux = {};

  const giftsMap = new Map<number, CustomGift>();
  if (gifts && gifts.length > 0) {
    for (const g of gifts) {
      giftsMap.set(g.value, g);
    }
  }

  const read = (setting: OverlayConfigLeaf) => {
    if (setting.type === "gifts") {
      const val = setting.attributes.value;
      if (!gifts || val == null) {
        // A single gift field reads as no gift, not an (always truthy) list.
        return setting.attributes.multiple ? [] : undefined;
      }

      const ids = Array.isArray(val) ? val : [val];

      const res = ids
        .map((id) => giftsMap.get(id))
        .filter((g): g is CustomGift => g !== undefined);

      return setting.attributes.multiple ? res : res[0];
    }
    if (setting.type === "color") return `#${setting.attributes.value}`;
    return setting.attributes.value;
  };

  for (const setting of data.fields) {
    if (setting.type === "table") {
      const { columns, value } = setting.attributes;
      extracted[setting.id] = value.map((row) =>
        Object.fromEntries(
          columns.map((column) => [
            column.id,
            read(cellField(column, row[column.id])),
          ]),
        ),
      );
    } else {
      extracted[setting.id] = read(setting);
    }
  }

  return extracted;
}
