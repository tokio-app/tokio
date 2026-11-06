import {
  STUDIO_KINDS,
  STUDIO_MAX_LAYERS,
  StudioLayer,
  StudioLayerKind,
} from "@/common/schemas";
import { Btn } from "@/components";
import { cx } from "@/helper/cx";
import { useMenu } from "@/hooks";
import { useT } from "@/ui/i18n";
import { useState } from "react";
import { flushSync } from "react-dom";
import { FiPlus, FiTrash2 } from "react-icons/fi";
import { LuGripVertical } from "react-icons/lu";
import { KIND_NAMES } from "./helper";
import styles from "./studioeditor.module.css";

type Props = {
  // Back to front, as the overlay keeps them
  layers: StudioLayer[];
  selected: string | null;
  // What each layer's row says: its name, and its kind and When
  names: Record<string, { name: string; meta: string }>;
  onSelect: (id: string) => void;
  onAdd: (kind: StudioLayerKind) => void;
  onDelete: (id: string) => void;
  // Moves a layer to `to`, an index of the layers back to front
  onMove: (id: string, to: number) => void;
};

/**
 * The overlay's layers, the front on top: select one, drag its grip or use
 * its arrows to reorder, delete it, or add one from the menu.
 */
export function LayersPanel({
  layers,
  selected,
  names,
  onSelect,
  onAdd,
  onDelete,
  onMove,
}: Props) {
  const t = useT();
  const menu = useMenu();
  // The row being dragged, and the row it's over
  const [drag, setDrag] = useState<{ id: string; over?: string } | null>(null);
  // Top = front
  const rows = [...layers].reverse();
  const from = rows.findIndex((l) => l.id === drag?.id);
  const full = layers.length >= STUDIO_MAX_LAYERS;
  const add = full
    ? t("studio.editor.full", { max: String(STUDIO_MAX_LAYERS) })
    : t("studio.editor.addLayer");
  const reorder = t("studio.editor.move");
  // A row's place in the list, as an index of the layers back to front
  const toLayers = (row: number) => layers.length - 1 - row;

  return (
    <div className={styles.panel}>
      <div className={styles.panel_header}>
        <h3 className={styles.panel_title}>{t("studio.editor.layers")}</h3>
        <div
          className={styles.menu_anchor}
          ref={menu.ref}
          onKeyDown={menu.onKeyDown}
        >
          <Btn
            ref={menu.toggleRef}
            variant="icon"
            title={add}
            aria-label={add}
            aria-haspopup="menu"
            aria-expanded={menu.open}
            disabled={full}
            onClick={menu.toggle}
          >
            <FiPlus size={20} />
          </Btn>
          {menu.open && (
            <div className={styles.menu} role="menu" aria-label={add}>
              {STUDIO_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  role="menuitem"
                  className={styles.menu_item}
                  onClick={() => {
                    menu.close();
                    onAdd(kind);
                  }}
                >
                  {t(KIND_NAMES[kind])}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className={styles.panel_empty}>{t("studio.editor.noLayers")}</p>
      ) : (
        <ul
          className={styles.layers}
          aria-label={t("studio.editor.layers")}
          // Only a row's own drag drops here, not files or text
          onDragOver={(e) => {
            if (drag) e.preventDefault();
          }}
          onDrop={(e) => {
            if (!drag) return;
            e.preventDefault();
            const over = rows.findIndex((l) => l.id === drag.over);
            if (over !== -1) onMove(drag.id, toLayers(over));
            setDrag(null);
          }}
          // Also when it's cancelled or dropped elsewhere: nothing moves
          onDragEnd={() => setDrag(null)}
        >
          {rows.map((layer, index) => {
            const { name, meta } = names[layer.id];
            const drop =
              from === -1 || index === from || layer.id !== drag?.over
                ? undefined
                : index > from
                  ? "after"
                  : "before";
            return (
              <li
                key={layer.id}
                className={cx(
                  styles.layer,
                  layer.id === selected && styles.layer_selected,
                  index === from && styles.layer_dragged,
                  drop === "before" && styles.layer_before,
                  drop === "after" && styles.layer_after,
                )}
                onDragEnter={() => {
                  if (drag && drag.over !== layer.id) {
                    setDrag({ ...drag, over: layer.id });
                  }
                }}
              >
                <Btn
                  variant="icon"
                  className={styles.grip}
                  title={reorder}
                  aria-label={reorder}
                  aria-keyshortcuts="ArrowUp ArrowDown"
                  draggable
                  onDragStart={(e) => {
                    // The whole row follows the pointer, held where it was
                    // grabbed
                    const row = e.currentTarget.closest("li")!;
                    const box = row.getBoundingClientRect();
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setDragImage(
                      row,
                      e.clientX - box.left,
                      e.clientY - box.top,
                    );
                    setDrag({ id: layer.id });
                  }}
                  onKeyDown={(e) => {
                    // Up the list is toward the front
                    const by =
                      e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
                    if (!by) return;
                    e.preventDefault();
                    const handle = e.currentTarget;
                    // Synchronous, so the handle takes the focus back: moving
                    // its row drops it on <body>
                    flushSync(() => onMove(layer.id, toLayers(index + by)));
                    handle.focus();
                  }}
                >
                  <LuGripVertical size={16} />
                </Btn>
                <button
                  type="button"
                  className={styles.layer_select}
                  aria-pressed={layer.id === selected}
                  onClick={() => onSelect(layer.id)}
                >
                  <span className={styles.layer_name}>{name}</span>
                  {/* Read as two phrases, not one run-on word */}{" "}
                  <span className={styles.layer_meta}>{meta}</span>
                </button>
                <Btn
                  variant="icon"
                  title={t("studio.editor.deleteLayer")}
                  aria-label={t("studio.editor.deleteLayer")}
                  onClick={() => onDelete(layer.id)}
                >
                  <FiTrash2 size={16} />
                </Btn>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
