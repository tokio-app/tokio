import { z } from "zod";
import { CustomGift, OverlayConfigRedux } from "../types/overlay";

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
  .regex(
    /^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/i,
    "Must be a 6 or 8-character hex code",
  );

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

const FieldsSchema = z.discriminatedUnion("type", [
  InputSetting,
  DropdownSetting,
  ColorSetting,
  CheckSetting,
  ToggleSetting,
  GiftsSetting,
  SliderSetting,
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
          path: ["config", index, "section"],
        });
      }

      if (seenFieldIds.has(field.id)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate field ID found: '${field.id}'. Each field must have a unique ID.`,
          path: ["config", index, "id"],
        });
      }

      seenFieldIds.add(field.id);
    });
  });

export type OverlayConfig = z.infer<typeof OverlayConfigSchema>;
export type OverlayConfigField = z.infer<typeof FieldsSchema>;

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
 * (sliders). Other fields keep the new version's values.
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
    if (old && fits(field, old.attributes.value)) {
      // fits checked it against the field's default.
      Object.assign(field.attributes, {
        value: structuredClone(old.attributes.value),
      });
    }
  }
  return merged;
}

// Whether a saved value can be the field's value.
function fits(field: OverlayConfigField, value: unknown): boolean {
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
 * colors with their `#` and gift ids resolved to the gifts.
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

  for (const setting of data.fields) {
    if (setting.type === "gifts") {
      const val = setting.attributes.value;
      if (!gifts || val == null) {
        extracted[setting.id] = [];
        continue;
      }

      const ids = Array.isArray(val) ? val : [val];

      const res = ids
        .map((id) => giftsMap.get(id))
        .filter((g): g is CustomGift => g !== undefined);

      extracted[setting.id] = setting.attributes.multiple ? res : res[0];
    } else if (setting.type === "color") {
      extracted[setting.id] = `#${setting.attributes.value}`;
    } else {
      extracted[setting.id] = setting.attributes.value;
    }
  }

  return extracted;
}
