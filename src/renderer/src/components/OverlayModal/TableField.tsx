import {
  cellField,
  OverlayConfigColumn,
  OverlayConfigRow,
  OverlayConfigTable,
} from "@/common/schemas";
import { CustomGift } from "@/common/types";
import { cx } from "@/helper/cx";
import { useT } from "@/ui/i18n";
import { useId, useRef } from "react";
import { flushSync } from "react-dom";
import { FiPlus, FiTrash2 } from "react-icons/fi";
import { Btn } from "../Elements";
import { FieldControl } from "./FieldControl";
import styles from "./overlaymodal.module.css";

// Columns as narrow as their control, so text fields and dropdowns get the rest
const NARROW = new Set<OverlayConfigColumn["type"]>([
  "color",
  "check",
  "toggle",
]);

const FOCUSABLE = "input, button, [tabindex]";

interface Props {
  table: OverlayConfigTable;
  gifts: CustomGift[];
  onChange: (rows: OverlayConfigRow[]) => void;
}

/** A table field's rows, a control per cell, with Add and a remove per row. */
export function TableField({ table, gifts, onChange }: Props) {
  const t = useT();
  const id = useId();
  const body = useRef<HTMLTableSectionElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const removeRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const { columns, max, value: rows } = table.attributes;
  // Column ids can hold spaces, which an id list can't
  const headerId = (c: number) => `${id}-${c}`;

  const setCell = (r: number, column: string, cell: unknown) => {
    const next = structuredClone(rows);
    // Each control gives a value of its column's type.
    Object.assign(next[r], { [column]: cell });
    onChange(next);
  };

  // Synchronous, so the focus moves before the browser drops it on <body>,
  // where the dialog's Escape and Tab never see the keys
  const remove = (r: number) => {
    flushSync(() => onChange(rows.filter((_, i) => i !== r)));
    if (r === rows.length - 1) {
      (r > 0 ? removeRefs.current[r - 1] : addRef.current)?.focus();
    }
  };

  // The new row's first control takes the focus, so Add turning disabled at
  // max drops nothing
  const add = () => {
    const row = Object.fromEntries(
      columns.map((column) => [
        column.id,
        structuredClone(column.attributes.default),
      ]),
    );
    flushSync(() => onChange([...rows, row]));
    body.current?.lastElementChild
      ?.querySelector<HTMLElement>(FOCUSABLE)
      ?.focus();
  };

  return (
    <div className={styles.table_field}>
      {rows.length > 0 && (
        <div className={styles.table_box}>
          <table className={styles.table}>
            <thead>
              <tr>
                {columns.map((column, c) => (
                  <th
                    key={column.id}
                    id={headerId(c)}
                    scope="col"
                    className={cx(NARROW.has(column.type) && styles.narrow)}
                  >
                    {column.name}
                  </th>
                ))}
                <td className={styles.pinned} />
              </tr>
            </thead>
            <tbody ref={body}>
              {rows.map((row, r) => (
                <tr key={r}>
                  {columns.map((column, c) => (
                    <td key={column.id}>
                      <div
                        role="group"
                        aria-labelledby={headerId(c)}
                        className={cx(!NARROW.has(column.type) && styles.wide)}
                      >
                        <FieldControl
                          field={cellField(column, row[column.id])}
                          gifts={gifts}
                          onChange={(cell) => setCell(r, column.id, cell)}
                        />
                      </div>
                    </td>
                  ))}
                  <td className={styles.pinned}>
                    <Btn
                      ref={(el) => {
                        removeRefs.current[r] = el;
                      }}
                      variant="icon"
                      title={t("common.remove")}
                      onClick={() => remove(r)}
                    >
                      <FiTrash2 size={18} />
                    </Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Btn
        ref={addRef}
        className={styles.add}
        disabled={max !== undefined && rows.length >= max}
        onClick={add}
      >
        <FiPlus size={16} />
        {t("common.add")}
      </Btn>
    </div>
  );
}
