import { OverlayConfigField } from "@/common/schemas";
import { CustomGift } from "@/common/types";
import { cx } from "@/helper/cx";
import { ReactNode, useId } from "react";
import { VscDiscard } from "react-icons/vsc";
import {
  Btn,
  Check,
  Color,
  Input,
  MultiSelect,
  NumberInput,
  Select,
  Slider,
  Toggle,
} from "../Elements";
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

/** Compares field values: primitives, or lists of them. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

interface Props {
  field: OverlayConfigField;
  gifts: CustomGift[];
  onChange: (value: unknown) => void;
  onReset: () => void;
}

export function SettingField({ field, gifts, onChange, onReset }: Props) {
  const changed = !sameValue(field.attributes.value, field.attributes.default);
  const labelId = useId();

  // Kept in place while hidden, so the values beside it don't move.
  const reset = (
    <Btn
      variant="icon"
      title="Reset to default"
      className={cx(styles.reset, !changed && styles.reset_hidden)}
      disabled={!changed}
      onClick={onReset}
    >
      <VscDiscard size={16} />
    </Btn>
  );

  // A label over its control
  const stacked = (control: ReactNode, value?: ReactNode) => (
    <div className={styles.field} role="group" aria-labelledby={labelId}>
      <div className={styles.field_header}>
        <label id={labelId} className={styles.label}>
          {field.name}
        </label>
        {value !== undefined && <span className={styles.value}>{value}</span>}
        {reset}
      </div>
      {control}
    </div>
  );

  switch (field.type) {
    case "input":
      return stacked(
        field.attributes.mode === "number" ? (
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
        ),
      );

    case "dropdown":
      return stacked(
        field.attributes.multiple ? (
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
        ),
      );

    case "gifts":
      return stacked(
        field.attributes.multiple ? (
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
        ),
      );

    case "slider":
      return stacked(
        <Slider
          className={styles.slider}
          min={field.attributes.min}
          max={field.attributes.max}
          value={field.attributes.value}
          onChange={onChange}
        />,
        field.attributes.value,
      );

    // The swatch first, so its picker opens toward the middle of the window
    case "color":
      return (
        <div className={styles.row} role="group" aria-labelledby={labelId}>
          <Color
            value={`#${field.attributes.value}`}
            onChange={(color) => onChange(color.replace(/^#/, ""))}
          />
          <span id={labelId} className={styles.label}>
            {field.name}
          </span>
          {reset}
        </div>
      );

    // One click puts these back, so they have no reset
    case "check":
      return (
        <Check
          label={field.name}
          checked={field.attributes.value}
          onChange={(e) => onChange(e.target.checked)}
        />
      );

    case "toggle":
      return (
        <Toggle
          label={field.name}
          checked={field.attributes.value}
          onChange={(e) => onChange(e.target.checked)}
        />
      );

    default:
      return null;
  }
}
