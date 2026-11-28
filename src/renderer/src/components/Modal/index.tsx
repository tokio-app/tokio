import { useT } from "@/ui/i18n";
import {
  CSSProperties,
  KeyboardEvent,
  ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { VscClose } from "react-icons/vsc";
import { Btn } from "../Elements";
import { FieldContext } from "../Elements/useFieldControl";
import styles from "./modal.module.css";

const FOCUSABLE =
  "a[href], button, input, select, textarea, video[controls], audio[controls], [tabindex]";

// What Tab stops on inside a dialog
function tabbable(dialog: HTMLElement) {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    // Not tabIndex: a video without the attribute reports -1, yet its controls take Tab.
    (el) => !el.matches(':disabled, [tabindex^="-"]'),
  );
}

// Wraps Tab between its first and last controls, so Escape still reaches it
function keepTab(e: KeyboardEvent<HTMLDivElement>) {
  const dialog = e.currentTarget;
  const focused = document.activeElement;
  // Select's search moves the focus itself, and portaled popovers are outside
  if (e.defaultPrevented || !focused || !dialog.contains(focused)) return;

  const items = tabbable(dialog);
  const first = items.at(0) ?? dialog;
  const last = items.at(-1) ?? dialog;
  const atEdge = e.shiftKey
    ? focused === first || focused === dialog
    : focused === last;
  if (!atEdge) return;
  e.preventDefault();
  (e.shiftKey ? last : first).focus();
}

// The open dialogs' backdrops, in the order they opened
const openDialogs: HTMLElement[] = [];
// What inertBehind made inert, to give back
const madeInert = new Set<Element>();

// The innermost dialog: one opened inside another is above it
function topDialog() {
  return openDialogs.findLast(
    (el) => !openDialogs.some((other) => other !== el && el.contains(other)),
  );
}

/**
 * Makes everything but the top dialog inert, lower dialogs included, so Tab
 * and screen readers can't reach the page behind it. What's marked
 * `data-over-dialogs` stays live: the window's controls and the toasts.
 * Popovers a dialog portals to <body> mount after this, so they stay live too.
 * shortcut: what mounts beside the dialog's ancestors after it opens stays
 * live; watch the DOM if a page ever adds one behind an open dialog.
 */
function inertBehind() {
  for (const el of madeInert) el.removeAttribute("inert");
  madeInert.clear();
  const top = topDialog();
  if (!top) return;
  const live = [top, ...document.querySelectorAll("[data-over-dialogs]")];
  const walk = (parent: Element) => {
    for (const child of parent.children) {
      if (live.includes(child)) continue;
      if (live.some((el) => child.contains(el))) walk(child);
      else if (!child.hasAttribute("inert")) {
        child.setAttribute("inert", "");
        madeInert.add(child);
      }
    }
  };
  walk(document.body);
}

// The focus fell on <body>, as when the focused control leaves the DOM
const focusLost = () =>
  !document.activeElement || document.activeElement === document.body;

type Props = {
  title: string;
  description?: ReactNode;
  // Also called on Escape
  onClose: () => void;
  // With onConfirm and no footer, the footer is Cancel and a confirm button
  onConfirm?: () => void;
  confirmText?: string;
  // Replaces the default footer
  footer?: ReactNode;
  // At the end of the title's row, such as a search
  actions?: ReactNode;
  // Adds a close button to the header
  closeButton?: boolean;
  maxWidth?: string;
  // Puts the card there instead of the window's center, over a backdrop that
  // doesn't dim: the caller dims around what the card is about (the tour)
  at?: Pick<CSSProperties, "top" | "left" | "translate">;
  // Near the window's top instead of its center, for a card whose height
  // changes as it's used: only its foot moves
  top?: boolean;
  children?: ReactNode;
};

export function Modal({
  title,
  description,
  onClose,
  onConfirm,
  confirmText,
  footer,
  actions,
  closeButton,
  maxWidth = "400px",
  at,
  top,
  children,
}: Props) {
  const t = useT();
  const titleId = useId();
  const descriptionId = useId();
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // What had the focus before it opened, read before an autoFocus inside
  const [opener] = useState(() => document.activeElement);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  // A layout effect, so the page is live again before the layout effects of
  // what closed it run: useFocusAfterDelete focuses a row, which an inert
  // page would refuse
  useLayoutEffect(() => {
    const backdrop = backdropRef.current!;
    openDialogs.push(backdrop);
    inertBehind();
    return () => {
      openDialogs.splice(openDialogs.indexOf(backdrop), 1);
      inertBehind();
    };
  }, []);

  // Takes the focus, so Escape reaches it, and gives it back on close.
  useEffect(() => {
    const backdrop = backdropRef.current!;
    const dialog = dialogRef.current!;
    if (!dialog.contains(document.activeElement)) dialog.focus();

    // With the focus on <body>, the card's own keys don't fire: Escape
    // still closes it and Tab goes back in
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (topDialog() !== backdrop || !focusLost()) return;
      if (e.key === "Escape") {
        closeRef.current();
      } else if (e.key === "Tab") {
        e.preventDefault();
        const items = tabbable(dialog);
        (e.shiftKey ? items.at(-1) : items.at(0))?.focus();
        if (focusLost()) dialog.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
      // Its opener left too, like a deleted sound's button or About's Take
      // the tour: the dialog under it takes the focus, or the page
      if (focusLost()) {
        const under =
          topDialog()?.querySelector<HTMLElement>('[role="dialog"]');
        (under ?? document.querySelector<HTMLElement>("main"))?.focus();
      }
    };
  }, [opener]);

  const buttons =
    footer ??
    (onConfirm && (
      <>
        <Btn onClick={onClose}>{t("common.cancel")}</Btn>
        <Btn variant="accent" onClick={onConfirm}>
          {confirmText ?? t("common.confirm")}
        </Btn>
      </>
    ));

  return (
    // A field the dialog was opened from doesn't name what's in it
    <FieldContext.Provider value={null}>
      <div
        ref={backdropRef}
        className={styles.backdrop}
        data-placed={at ? "" : undefined}
        data-top={top ? "" : undefined}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          tabIndex={-1}
          className={styles.card}
          style={{ maxWidth, ...at }}
          // A click on the backdrop drops the focus on <body>: it comes back
          onBlur={(e) => {
            const dialog = e.currentTarget;
            setTimeout(() => {
              const top = topDialog() === backdropRef.current;
              if (top && focusLost() && document.hasFocus()) dialog.focus();
            });
          }}
          onKeyDown={(e) => {
            if (e.key === "Tab") keepTab(e);
            if (e.key !== "Escape") return;
            // Only the innermost dialog closes, e.g. a picker over a modal
            e.stopPropagation();
            onClose();
          }}
        >
          <div className={styles.header}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            {actions && <div className={styles.actions}>{actions}</div>}
            {closeButton && (
              <Btn variant="icon" title={t("common.close")} onClick={onClose}>
                <VscClose size={24} />
              </Btn>
            )}
          </div>

          {description && (
            <p id={descriptionId} className={styles.description}>
              {description}
            </p>
          )}

          {children && <div className={styles.body}>{children}</div>}

          {buttons && <div className={styles.footer}>{buttons}</div>}
        </div>
      </div>
    </FieldContext.Provider>
  );
}
