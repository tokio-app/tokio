import { OverlayConfigField } from "@/common/schemas";
import { CustomGift } from "@/common/types";
import { cx } from "@/helper/cx";
import { useT } from "@/ui/i18n";
import isEqual from "fast-deep-equal";
import { ReactNode, useId } from "react";
import { VscDiscard } from "react-icons/vsc";
import { Btn } from "../Elements";
import { FieldControl } from "./FieldControl";
import styles from "./overlaymodal.module.css";
import { TableField } from "./TableField";

interface Props {
  field: OverlayConfigField;
  gifts: CustomGift[];
  onChange: (value: unknown) => void;
  onReset: () => void;
}

export function SettingField({ field, gifts, onChange, onReset }: Props) {
  const changed = !isEqual(field.attributes.value, field.attributes.default);
  const t = useT();
  const labelId = useId();

  // Kept in place while hidden, so the values beside it don't move.
  const reset = (
    <Btn
      variant="icon"
      title={t("components.overlayModal.reset")}
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

  if (field.type === "table") {
    const { max, value } = field.attributes;
    return stacked(
      <TableField table={field} gifts={gifts} onChange={onChange} />,
      max === undefined
        ? undefined
        : t("components.overlayModal.rows", {
            count: value.length,
            max,
          }),
    );
  }

  const control = (
    <FieldControl
      field={field}
      gifts={gifts}
      label={field.name}
      onChange={onChange}
    />
  );

  switch (field.type) {
    case "slider":
      return stacked(control, field.attributes.value);

    // The swatch first, so its picker opens toward the middle of the window
    case "color":
      return (
        <div className={styles.row} role="group" aria-labelledby={labelId}>
          {control}
          <span id={labelId} className={styles.label}>
            {field.name}
          </span>
          {reset}
        </div>
      );

    // One click puts these back, so they have no reset
    case "check":
    case "toggle":
      return control;

    case "font":
      return stacked(
        <>
          {control}
          <p className={styles.note}>{t("common.fontsNote")}</p>
        </>,
      );

    default:
      return stacked(control);
  }
}
