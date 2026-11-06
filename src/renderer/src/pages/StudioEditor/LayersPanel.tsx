import {
  STUDIO_KINDS,
  STUDIO_MAX_ELEMENTS,
  STUDIO_MAX_GROUPS,
  StudioElement,
  StudioElementKind,
  StudioGroup,
  StudioItem,
} from "@/common/schemas";
import { Btn, Modal } from "@/components";
import { cx } from "@/helper/cx";
import { useMenu } from "@/hooks";
import { useT } from "@/ui/i18n";
import { DragEvent, KeyboardEvent, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  FiChevronDown,
  FiChevronRight,
  FiEye,
  FiEyeOff,
  FiLock,
  FiPlus,
  FiTrash2,
  FiUnlock,
} from "react-icons/fi";
import { LuGripVertical } from "react-icons/lu";
import { findElement, KIND_NAMES } from "./helper";
import styles from "./studioeditor.module.css";

export type GroupFlags = Partial<
  Pick<StudioGroup, "folded" | "locked" | "hidden">
>;
export type ElementFlags = Partial<Pick<StudioElement, "locked" | "hidden">>;

type Props = {
  // Back to front, as the overlay keeps them, and so are groups' elements
  items: StudioItem[];
  // A group's id or an element's
  selected: string | null;
  // What each element's row says: its name, and its kind and When
  names: Record<string, { name: string; meta: string }>;
  // The group the menu adds to, none to add on its own
  target: StudioGroup | undefined;
  onSelect: (id: string) => void;
  onAddGroup: () => void;
  onAdd: (kind: StudioElementKind) => void;
  // Deletes a group with its elements, or an element
  onDelete: (id: string) => void;
  onFlags: (groupId: string, flags: GroupFlags) => void;
  onElementFlags: (elementId: string, flags: ElementFlags) => void;
  // Moves a group or an element on its own to `to`, an index of the items
  // back to front
  onMoveItem: (id: string, to: number) => void;
  // Moves an element into a group, or on its own with null, at `at`: an
  // index back to front of that group's elements, or of the items, once the
  // element is taken out
  onMoveElement: (id: string, groupId: string | null, at: number) => void;
  // One step toward the front (1) or the back (-1), in or out of groups
  onStepElement: (id: string, by: 1 | -1) => void;
};

// The row the dragged one is over: an item's (a group's, or an element's
// on its own), or an element's in a group. `edge` is a group row's top
// quarter, which drops in front of the group instead of into it.
type Over = { item: string; element?: string; edge?: boolean };

// Where a drop lands: the line on a row or a group's item, and the move
type Plan = { on: string; line: "before" | "after"; run: () => void };

// Up the list is toward the front
const stepOf = (e: KeyboardEvent) =>
  e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0;

/**
 * The overlay's groups and the elements on their own as a tree, the front
 * on top, each group with its elements under it: select one, fold, lock or
 * hide a group, lock or hide an element, drag a grip or use its arrows to
 * reorder, and add or delete from the header.
 */
export function LayersPanel({
  items,
  selected,
  names,
  target,
  onSelect,
  onAddGroup,
  onAdd,
  onDelete,
  onFlags,
  onElementFlags,
  onMoveItem,
  onMoveElement,
  onStepElement,
}: Props) {
  const t = useT();
  const menu = useMenu();
  const caption = useId();
  const list = useRef<HTMLUListElement>(null);
  // The row being dragged, whether it's a group's, and the row it's over
  const [drag, setDrag] = useState<{
    id: string;
    group: boolean;
    over?: Over;
  } | null>(null);
  // A group that still holds elements, waiting to be confirmed
  const [confirm, setConfirm] = useState<StudioGroup | null>(null);

  // Top = front
  const rows = [...items].reverse();
  const groups = items.filter((item) => item.kind === "group");
  const groupName = (group: StudioGroup) =>
    group.name.trim() || t("studio.editor.untitledGroup");
  // Every row in the list's order, to tell which way a drag goes
  const order = rows.flatMap((item) => [
    item.id,
    ...(item.kind === "group" && !item.folded
      ? [...item.elements].reverse().map((e) => e.id)
      : []),
  ]);

  const groupsFull = groups.length >= STUDIO_MAX_GROUPS;
  const elementsFull =
    items.reduce(
      (n, item) => n + (item.kind === "group" ? item.elements.length : 1),
      0,
    ) >= STUDIO_MAX_ELEMENTS;
  const add = t("studio.editor.addGroup");
  const reorder = t("studio.editor.move");
  const fold = t("studio.editor.fold");
  const lock = t("studio.editor.lock");
  const hide = t("studio.editor.hide");
  const lockElement = t("studio.editor.lockElement");
  const hideElement = t("studio.editor.hideElement");

  // A lock and an eye, Paper when on and muted when off
  const toggles = (
    flags: { locked: boolean; hidden: boolean },
    labels: { lock: string; hide: string },
    set: (flags: ElementFlags) => void,
  ) => (
    <>
      <Btn
        variant="icon"
        className={cx(styles.toggle, flags.locked && styles.toggle_on)}
        title={labels.lock}
        aria-label={labels.lock}
        aria-pressed={flags.locked}
        onClick={() => set({ locked: !flags.locked })}
      >
        {flags.locked ? <FiLock size={16} /> : <FiUnlock size={16} />}
      </Btn>
      <Btn
        variant="icon"
        className={cx(styles.toggle, flags.hidden && styles.toggle_on)}
        title={labels.hide}
        aria-label={labels.hide}
        aria-pressed={flags.hidden}
        onClick={() => set({ hidden: !flags.hidden })}
      >
        {flags.hidden ? <FiEyeOff size={16} /> : <FiEye size={16} />}
      </Btn>
    </>
  );

  const selectedGroup = groups.find((g) => g.id === selected);
  const selectedElement =
    !selectedGroup && selected !== null && findElement(items, selected);
  const remove = selectedGroup
    ? t("studio.editor.deleteGroup")
    : selectedElement
      ? t("studio.editor.deleteElement")
      : t("studio.editor.deleteNone");

  const plan = ((): Plan | null => {
    const over = drag?.over;
    if (!drag || !over) return null;
    const to = items.findIndex((i) => i.id === over.item);
    const item = items[to];
    if (drag.group) {
      const from = items.findIndex((i) => i.id === drag.id);
      if (from === to) return null;
      return {
        on: over.item,
        // It takes that item's place, from below or above
        line: to > from ? "before" : "after",
        run: () => onMoveItem(drag.id, to),
      };
    }
    const down = (id: string) => order.indexOf(drag.id) < order.indexOf(id);
    if (item.kind === "group" && over.element !== undefined) {
      if (over.element === drag.id) return null;
      const rest = item.elements.filter((e) => e.id !== drag.id);
      const at = rest.findIndex((e) => e.id === over.element);
      const below = down(over.element);
      return {
        on: over.element,
        line: below ? "after" : "before",
        // Below it is behind it
        run: () => onMoveElement(drag.id, item.id, below ? at : at + 1),
      };
    }
    if (item.kind === "group" && !over.edge) {
      // In front in that group, unless it's there already
      if (item.elements.at(-1)?.id === drag.id) return null;
      return {
        on: item.id,
        line: "after",
        run: () =>
          onMoveElement(
            drag.id,
            item.id,
            item.elements.filter((e) => e.id !== drag.id).length,
          ),
      };
    }
    // On its own: in front of a group, or in an element's place
    if (item.id === drag.id) return null;
    const rest = items.filter((i) => i.id !== drag.id);
    const at = rest.indexOf(item);
    if (item.kind === "group") {
      if (items[to + 1]?.id === drag.id) return null;
      return {
        on: item.id,
        line: "before",
        run: () => onMoveElement(drag.id, null, at + 1),
      };
    }
    const below = down(item.id);
    return {
      on: item.id,
      line: below ? "after" : "before",
      run: () => onMoveElement(drag.id, null, below ? at : at + 1),
    };
  })();

  const lineOf = (on: string, applies: boolean) =>
    applies && plan?.on === on
      ? plan.line === "before"
        ? styles.layer_before
        : styles.layer_after
      : undefined;

  const dragOver = (e: DragEvent<HTMLElement>, over: Omit<Over, "edge">) => {
    if (!drag) return;
    const box = e.currentTarget.getBoundingClientRect();
    const edge =
      over.element === undefined && e.clientY < box.top + box.height / 4;
    const was = drag.over;
    if (
      was?.item !== over.item ||
      was.element !== over.element ||
      !!was.edge !== edge
    ) {
      setDrag({ ...drag, over: { ...over, edge } });
    }
  };

  const startDrag = (e: DragEvent<HTMLElement>, id: string, group: boolean) => {
    // The whole row follows the pointer, held where it was grabbed
    const row = e.currentTarget.closest<HTMLElement>("[data-row]")!;
    const box = row.getBoundingClientRect();
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setDragImage(row, e.clientX - box.left, e.clientY - box.top);
    setDrag({ id, group });
  };

  const step = (e: KeyboardEvent, id: string, move: (by: 1 | -1) => void) => {
    const by = stepOf(e);
    if (!by) return;
    e.preventDefault();
    // Synchronous, so its grip takes the focus back: a row that moves drops
    // it on <body>, and one that goes in or out of a group is a new row
    flushSync(() => move(by));
    list.current?.querySelector<HTMLElement>(`[data-grip="${id}"]`)?.focus();
  };

  const grip = (id: string, group: boolean, move: (by: 1 | -1) => void) => (
    <Btn
      variant="icon"
      className={styles.grip}
      title={reorder}
      aria-label={reorder}
      aria-keyshortcuts="ArrowUp ArrowDown"
      data-grip={id}
      draggable
      onDragStart={(e) => startDrag(e, id, group)}
      onKeyDown={(e) => step(e, id, move)}
    >
      <LuGripVertical size={16} />
    </Btn>
  );

  // An element's row, in its group's list or on its own in the top one
  const elementRow = (element: StudioElement, item: string) => {
    const { name, meta } = names[element.id];
    const inGroup = item !== element.id;
    return (
      <li
        key={element.id}
        data-row
        className={cx(
          styles.layer,
          styles.element_row,
          element.hidden && styles.element_hidden,
          element.id === selected && styles.layer_selected,
          drag?.id === element.id && styles.layer_dragged,
          // A group's drag lines up with what stands on its own
          lineOf(element.id, !drag?.group || !inGroup),
        )}
        onDragOver={(e) =>
          dragOver(e, inGroup ? { item, element: element.id } : { item })
        }
      >
        {grip(element.id, false, (by) => onStepElement(element.id, by))}
        <button
          type="button"
          className={styles.layer_select}
          aria-pressed={element.id === selected}
          onClick={() => onSelect(element.id)}
        >
          <span className={styles.layer_name}>{name}</span>
          {/* Read as two phrases, not one run-on word */}{" "}
          <span className={styles.layer_meta}>{meta}</span>
        </button>
        {toggles(element, { lock: lockElement, hide: hideElement }, (flags) =>
          onElementFlags(element.id, flags),
        )}
      </li>
    );
  };

  const groupItem = (group: StudioGroup) => {
    const index = items.indexOf(group);
    const name = groupName(group);
    const shown = !group.folded && group.elements.length > 0;
    return (
      <li
        key={group.id}
        className={cx(
          styles.group_item,
          group.hidden && styles.group_hidden,
          drag?.id === group.id && styles.layer_dragged,
          lineOf(group.id, !!drag?.group),
        )}
      >
        <div
          data-row
          className={cx(
            styles.layer,
            styles.group_row,
            group.id === selected && styles.layer_selected,
            lineOf(group.id, drag?.group === false),
          )}
          onDragOver={(e) => dragOver(e, { item: group.id })}
        >
          {grip(group.id, true, (by) => onMoveItem(group.id, index + by))}
          {group.elements.length > 0 ? (
            <Btn
              variant="icon"
              title={fold}
              aria-label={fold}
              aria-expanded={!group.folded}
              onClick={() => onFlags(group.id, { folded: !group.folded })}
            >
              {group.folded ? (
                <FiChevronRight size={16} />
              ) : (
                <FiChevronDown size={16} />
              )}
            </Btn>
          ) : (
            <span className={styles.fold_space} aria-hidden />
          )}
          <button
            type="button"
            className={styles.layer_select}
            aria-pressed={group.id === selected}
            onClick={() => onSelect(group.id)}
          >
            <span className={styles.layer_name}>{name}</span>
            {/* Read as two phrases, not one run-on word */}{" "}
            <span className={styles.layer_meta}>
              {t("studio.editor.elements", { count: group.elements.length })}
            </span>
          </button>
          {toggles(group, { lock, hide }, (flags) => onFlags(group.id, flags))}
        </div>

        {shown && (
          <ul className={styles.elements} aria-label={name}>
            {[...group.elements]
              .reverse()
              .map((element) => elementRow(element, group.id))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className={styles.panel}>
      <div className={styles.panel_header}>
        <h3 className={styles.panel_title}>{t("studio.editor.layers")}</h3>
        <div className={styles.panel_actions}>
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
              onClick={menu.toggle}
            >
              <FiPlus size={20} />
            </Btn>
            {menu.open && (
              <div className={styles.menu} role="menu" aria-label={add}>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menu_item}
                  disabled={groupsFull}
                  onClick={() => {
                    menu.close();
                    onAddGroup();
                  }}
                >
                  {t("studio.editor.newGroup")}
                </button>
                <div
                  role="group"
                  aria-labelledby={caption}
                  className={styles.menu_group}
                >
                  <span id={caption} className={styles.menu_caption}>
                    {target
                      ? t("studio.editor.addTo", { group: groupName(target) })
                      : t("studio.editor.addElement")}
                  </span>
                  {STUDIO_KINDS.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      role="menuitem"
                      className={styles.menu_item}
                      disabled={elementsFull}
                      onClick={() => {
                        menu.close();
                        onAdd(kind);
                      }}
                    >
                      {t(KIND_NAMES[kind])}
                    </button>
                  ))}
                </div>
                {(elementsFull || groupsFull) && (
                  <p className={styles.menu_note}>
                    {elementsFull
                      ? t("studio.editor.fullElements", {
                          max: String(STUDIO_MAX_ELEMENTS),
                        })
                      : t("studio.editor.full", {
                          max: String(STUDIO_MAX_GROUPS),
                        })}
                  </p>
                )}
              </div>
            )}
          </div>
          <Btn
            variant="icon"
            title={remove}
            aria-label={remove}
            disabled={selected === null}
            onClick={() => {
              if (selectedGroup?.elements.length) setConfirm(selectedGroup);
              else if (selected !== null) onDelete(selected);
            }}
          >
            <FiTrash2 size={18} />
          </Btn>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className={styles.panel_empty}>{t("studio.editor.noElements")}</p>
      ) : (
        <ul
          ref={list}
          className={styles.layers}
          aria-label={t("studio.editor.layers")}
          // Only a row's own drag drops here, not files or text
          onDragOver={(e) => {
            if (drag) e.preventDefault();
          }}
          onDrop={(e) => {
            if (!drag) return;
            e.preventDefault();
            plan?.run();
            setDrag(null);
          }}
          // Also when it's cancelled or dropped elsewhere: nothing moves
          onDragEnd={() => setDrag(null)}
        >
          {rows.map((item) =>
            item.kind === "group" ? groupItem(item) : elementRow(item, item.id),
          )}
        </ul>
      )}

      {confirm && (
        <Modal
          title={t("studio.editor.deleteTitle")}
          description={t("studio.editor.deleteText", {
            name: groupName(confirm),
            count: confirm.elements.length,
          })}
          confirmText={t("common.delete")}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            onDelete(confirm.id);
            setConfirm(null);
          }}
        />
      )}
    </div>
  );
}
