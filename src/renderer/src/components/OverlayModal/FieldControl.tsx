import { OverlayConfigLeaf } from "@/common/schemas";
import { CustomGift } from "@/common/types";
import { useT } from "@/ui/i18n";
import {
  Check,
  Color,
  Input,
  MultiSelect,
  NumberInput,
  Select,
  Slider,
  Toggle,
} from "../Elements";
import { FontSelect } from "../FontSelect";
import { GiftMultiSelect, GiftSelect } from "../GiftSelect";
import styles from "./overlaymodal.module.css";

type Value = string | number;

// Dropdown values are stored as one value or a list, depending on `multiple`.
function asList<V extends Value>(value: V | V[]): V[] {
  return Array.isArray(value) ? value : [value];
}

function asSingle<V extends Value>(value: V | V[]): V | undefined {
  return Array.isArray(value) ? value[0] : value;
}

interface Props {
  field: OverlayConfigLeaf;
  gifts: CustomGift[];
  // A check's or toggle's own label. Other controls are named by their group.
  label?: string;
  onChange: (value: unknown) => void;
}

/** The control of one value: a field's, or a table cell's. */
export function FieldControl({ field, gifts, label, onChange }: Props) {
  const t = useT();

  switch (field.type) {
    case "input":
      return field.attributes.mode === "number" ? (
        <NumberInput
          placeholder={field.attributes.placeholder}
          value={Number(field.attributes.value)}
          onChange={onChange}
        />
      ) : (
        <Input
          placeholder={field.attributes.placeholder}
          value={field.attributes.value}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "dropdown":
      return field.attributes.multiple ? (
        <MultiSelect
          searchable={field.attributes.searchable}
          options={field.attributes.options}
          value={asList<Value>(field.attributes.value)}
          onChange={onChange}
        />
      ) : (
        <Select
          searchable={field.attributes.searchable}
          options={field.attributes.options}
          value={asSingle<Value>(field.attributes.value)}
          onChange={onChange}
        />
      );

    case "gifts":
      return field.attributes.multiple ? (
        <GiftMultiSelect
          gifts={gifts}
          value={asList(field.attributes.value)}
          onChange={onChange}
        />
      ) : (
        <GiftSelect
          gifts={gifts}
          value={asSingle(field.attributes.value)}
          onChange={onChange}
        />
      );

    case "slider":
      return (
        <Slider
          className={styles.slider}
          min={field.attributes.min}
          max={field.attributes.max}
          value={field.attributes.value}
          onChange={onChange}
        />
      );

    case "color":
      return (
        <Color
          value={`#${field.attributes.value}`}
          onChange={(color) => onChange(color.replace(/^#/, ""))}
        />
      );

    case "check":
      return (
        <Check
          label={label}
          checked={field.attributes.value}
          onChange={(e) => onChange(e.target.checked)}
        />
      );

    case "toggle":
      return (
        <Toggle
          label={label}
          checked={field.attributes.value}
          onChange={(e) => onChange(e.target.checked)}
        />
      );

    // An overlay's own font isn't Archivo
    case "font":
      return (
        <FontSelect
          value={field.attributes.value}
          defaultLabel={t("components.overlayModal.overlayFont")}
          onChange={onChange}
        />
      );

    default:
      return null;
  }
}
