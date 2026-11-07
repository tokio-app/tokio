import {
  STUDIO_KINDS,
  STUDIO_MAX_ELEMENTS,
  STUDIO_MAX_GROUPS,
  StudioElement,
  StudioElementKind,
  StudioGroup,
  StudioItem,
} from "@/common/schemas";
import { CustomGift } from "@/common/types";
import { Btn } from "@/components";
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
import { LayerThumb } from "./LayerThumb";
import styles from "./studioeditor.module.css";

export type GroupFlags = Partial<Pick<StudioGroup, "locked" | "hidden">>;
export type ElementFlags = Partial<Pick<StudioElement, "locked" | "hidden">>;

type Props = {
  // Back to front, as the overlay keeps them, and so are groups' elements
  items: StudioItem[];
  // A group's id or an element's
  selected: string | null;
  // What each element's row says: its name, its kind and When for screen
  // readers, and the event it reacts to, null when it's always on screen
  names: Record<string, { name: string; meta: string; when: string | null }>;
  // For the pictures of the gifts elements show
  gifts: CustomGift[];
  // The group the menu adds to, none to add on its own
  target: StudioGroup | undefined;
  // A group's id or an element's, null to let go of the selection
  onSelect: (id: string | null) => void;
  onAddGroup: () => void;
  onAdd: (kind: StudioElementKind) => void;
  // Deletes a group with its elements, or an element
  onDelete: (id: string) => void;
  // The list's view, which Undo leaves alone
  onFold: (groupId: string, folded: boolean) => void;
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
// quarter, which drops in front of the group instead of into it. Off the
// rows, it's between items, in front of the one `between` names, or past
// the last with null: on its own there, out of any group.
type Over =
  | { item: string; element?: string; edge?: boolean }
  | { between: string | null };

// Tells two of them apart
const overKey = (over: Over | undefined) =>
  !over
    ? ""
    : "between" in over
      ? `between ${over.between}`
      : `${over.item} ${over.element} ${!!over.edge}`;

// Where a drop lands: the line on what it lands next to, and the move. The
// line is `outer` when the drop lands among the items: around a group's
// tray rather than on its row.
type Plan = {
  on: string;
  line: "before" | "after";
  outer?: boolean;
  run: () => void;
};

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
  gifts,
  target,
  onSelect,
  onAddGroup,
  onAdd,
  onDelete,
  onFold,
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
    if ("between" in over) {
      // In front of the item under the pointer's gap, or past the last: the
      // back. Positions count back to front, without the one dragged.
      const below = items.find((i) => i.id === over.between);
      if (below?.id === drag.id) return null;
      const rest = items.filter((i) => i.id !== drag.id);
      const at = below ? rest.indexOf(below) + 1 : 0;
      if (items.findIndex((i) => i.id === drag.id) === at) return null;
      return {
        on: below?.id ?? rows[rows.length - 1].id,
        line: below ? "before" : "after",
        outer: true,
        run: () =>
          drag.group
            ? onMoveItem(drag.id, at)
            : onMoveElement(drag.id, null, at),
      };
    }
    const to = items.findIndex((i) => i.id === over.item);
    const item = items[to];
    if (drag.group) {
      const from = items.findIndex((i) => i.id === drag.id);
      if (from === to) return null;
      return {
        on: over.item,
        // It takes that item's place, from below or above
        line: to > from ? "before" : "after",
        outer: true,
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
        outer: true,
        run: () => onMoveElement(drag.id, null, at + 1),
      };
    }
    const below = down(item.id);
    return {
      on: item.id,
      line: below ? "after" : "before",
      outer: true,
      run: () => onMoveElement(drag.id, null, below ? at : at + 1),
    };
  })();

  // The line where the drop lands: on a row, or when it lands among the
  // items, in the gap by a group's tray or an element's row on its own, so
  // it's plain the drop leaves any group
  const lineOf = (on: string, outer: boolean) => {
    if (plan?.on !== on || !!plan.outer !== outer) return undefined;
    if (outer) {
      return plan.line === "before" ? styles.drop_before : styles.drop_after;
    }
    return plan.line === "before" ? styles.layer_before : styles.layer_after;
  };

  const changeOver = (over: Over) => {
    if (drag && overKey(drag.over) !== overKey(over)) {
      setDrag({ ...drag, over });
    }
  };

  const dragOver = (
    e: DragEvent<HTMLElement>,
    over: { item: string; element?: string },
  ) => {
    if (!drag) return;
    const box = e.currentTarget.getBoundingClientRect();
    const edge =
      over.element === undefined && e.clientY < box.top + box.height / 4;
    changeOver({ ...over, edge });
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

  // Delete, and Backspace (a Mac's delete key), remove the selection as the
  // trash does. The focus goes on to the row after it, or before it at the
  // end, so the keyboard can go on.
  const removeByKey = (e: KeyboardEvent) => {
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    if (selected === null) return;
    e.preventDefault();
    const gone = new Set([
      selected,
      ...(selectedGroup?.elements.map((element) => element.id) ?? []),
    ]);
    const ids = Array.from(
      list.current?.querySelectorAll<HTMLElement>("[data-select]") ?? [],
    ).map((button) => button.dataset.select!);
    const at = ids.indexOf(selected);
    const next =
      ids.slice(at + 1).find((id) => !gone.has(id)) ??
      ids
        .slice(0, Math.max(at, 0))
        .reverse()
        .find((id) => !gone.has(id));
    flushSync(() => onDelete(selected));
    if (next) {
      list.current
        ?.querySelector<HTMLElement>(`[data-select="${next}"]`)
        ?.focus();
    }
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
    const { name, meta, when } = names[element.id];
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
          lineOf(element.id, !inGroup),
        )}
        data-item={inGroup ? undefined : element.id}
        onDragOver={(e) =>
          dragOver(e, inGroup ? { item, element: element.id } : { item })
        }
      >
        {grip(element.id, false, (by) => onStepElement(element.id, by))}
        <button
          type="button"
          className={styles.layer_select}
          aria-pressed={element.id === selected}
          data-select={element.id}
          onClick={() => onSelect(element.id)}
        >
          <LayerThumb element={element} gifts={gifts} />
          <span className={styles.layer_text}>
            <span className={styles.layer_name}>{name}</span>
            {/* Read as two phrases, not one run-on word */}{" "}
            {/* The picture says the kind, so its words are for screen readers */}
            <span className={styles.sr_only}>{meta}</span>
            {when && (
              <span className={styles.layer_when} aria-hidden>
                {when}
              </span>
            )}
          </span>
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
          group.id === selected && styles.group_selected,
          group.hidden && styles.group_hidden,
          drag?.id === group.id && styles.layer_dragged,
          lineOf(group.id, true),
        )}
        data-item={group.id}
      >
        <div
          data-row
          className={cx(
            styles.layer,
            styles.group_row,
            group.id === selected && styles.layer_selected,
            lineOf(group.id, false),
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
              onClick={() => onFold(group.id, !group.folded)}
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
            data-select={group.id}
            onClick={() => onSelect(group.id)}
          >
            <span className={styles.layer_text}>
              <span className={styles.layer_name}>{name}</span>
              {/* Read as two phrases, not one run-on word */}{" "}
              {/* Shown while its elements aren't under it */}
              <span className={shown ? styles.sr_only : styles.layer_count}>
                {t("studio.editor.elements", { count: group.elements.length })}
              </span>
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
        <h3 className={styles.panel_title}>{t("studio.editor.elementList")}</h3>
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
            // At once, a group with its elements too: Undo brings it back
            onClick={() => {
              if (selected !== null) onDelete(selected);
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
          aria-label={t("studio.editor.elementList")}
          // Only a row's own drag drops here, not files or text
          onDragOver={(e) => {
            if (!drag) return;
            e.preventDefault();
            if (e.target instanceof Element && e.target.closest("[data-row]")) {
              return;
            }
            // Off the rows: in front of the first item below the pointer
            const items = list.current?.querySelectorAll<HTMLElement>(
              ":scope > [data-item]",
            );
            const below = Array.from(items ?? []).find(
              (node) => node.getBoundingClientRect().top >= e.clientY,
            );
            changeOver({ between: below?.dataset.item ?? null });
          }}
          onDrop={(e) => {
            if (!drag) return;
            e.preventDefault();
            plan?.run();
            setDrag(null);
          }}
          // Also when it's cancelled or dropped elsewhere: nothing moves
          onDragEnd={() => setDrag(null)}
          onKeyDown={removeByKey}
          // A click past the items, under them or between them, lets go of
          // the selection, as a click on the empty canvas does
          onClick={(e) => {
            if (
              e.target instanceof Element &&
              !e.target.closest("[data-item]")
            ) {
              onSelect(null);
            }
          }}
        >
          {rows.map((item) =>
            item.kind === "group" ? groupItem(item) : elementRow(item, item.id),
          )}
        </ul>
      )}
    </div>
  );
}
