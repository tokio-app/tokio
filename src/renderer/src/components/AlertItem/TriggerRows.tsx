import { MAX_TRIGGERS } from "@/common/schemas";
import { cx } from "@/helper/cx";
import { useT } from "@/ui/i18n";
import { ReactNode } from "react";
import { FiPlus, FiX } from "react-icons/fi";
import { Btn } from "../Elements";
import { Field } from "../Page";
import styles from "./alertitem.module.css";

// One trigger row's fields: main goes in the row's frame, more follows it
export type TriggerRow = { main: ReactNode; more?: ReactNode };

type Props = {
  // How many triggers, the first included
  count: number;
  // The first row's label, which names its group
  label: string;
  // The fields of row index, its select named by name
  row: (index: number, name: string) => TriggerRow;
  onAdd: () => void;
  // Takes out row index, never the first
  onRemove: (index: number) => void;
  // False when there's one trigger to pick, another would only repeat it
  addable?: boolean;
  className?: string;
};

/**
 * The triggers of an alert or a Studio element: the first under its label,
 * each other under "Or" with a button to remove it, then **Add a trigger**,
 * up to MAX_TRIGGERS. The caller draws each row's fields.
 */
export function TriggerRows({
  count,
  label,
  row,
  onAdd,
  onRemove,
  addable = true,
  className,
}: Props) {
  const t = useT();
  const first = row(0, label);

  return (
    <div className={cx(styles.rows, className)}>
      <Field label={label}>{first.main}</Field>
      {first.more}
      {Array.from({ length: count - 1 }, (_, i) => {
        const index = i + 1;
        const number = String(index + 1);
        const name = t("components.triggers.row", { number });
        const remove = t("components.triggers.remove", { number });
        const { main, more } = row(index, name);
        return (
          <div key={i} className={styles.titled} role="group" aria-label={name}>
            <div className={styles.titled_head}>
              <span className={styles.titled_name}>
                {t("components.triggers.or")}
              </span>
              <Btn
                variant="icon"
                title={remove}
                aria-label={remove}
                onClick={() => onRemove(index)}
              >
                <FiX size={16} />
              </Btn>
            </div>
            {main}
            {more}
          </div>
        );
      })}
      {addable && (
        <Btn
          className={styles.add_trigger}
          disabled={count >= MAX_TRIGGERS}
          onClick={onAdd}
        >
          <FiPlus size={16} aria-hidden />
          {t("components.triggers.add")}
        </Btn>
      )}
    </div>
  );
}
