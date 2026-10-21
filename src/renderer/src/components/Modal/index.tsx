import {
  KeyboardEvent,
  ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { VscClose } from "react-icons/vsc";
import { Btn } from "../Elements";
import styles from "./modal.module.css";

const FOCUSABLE = "a[href], button, input, select, textarea, [tabindex]";

// Wraps Tab between its first and last controls, so Escape still reaches it
function keepTab(e: KeyboardEvent<HTMLDivElement>) {
  const dialog = e.currentTarget;
  const focused = document.activeElement;
  // Select's search moves the focus itself, and portaled popovers are outside
  if (e.defaultPrevented || !focused || !dialog.contains(focused)) return;

  const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.tabIndex >= 0 && !el.matches(":disabled"),
  );
  const first = items.at(0) ?? dialog;
  const last = items.at(-1) ?? dialog;
  const atEdge = e.shiftKey
    ? focused === first || focused === dialog
    : focused === last;
  if (!atEdge) return;
  e.preventDefault();
  (e.shiftKey ? last : first).focus();
}

type Props = {
  title: string;
  description?: string;
  // Also called on Escape
  onClose: () => void;
  // With onConfirm and no footer, the footer is Cancel and a confirm button
  onConfirm?: () => void;
  confirmText?: string;
  // Replaces the default footer
  footer?: ReactNode;
  // Adds a close button to the header
  closeButton?: boolean;
  maxWidth?: string;
  children?: ReactNode;
};

export function Modal({
  title,
  description,
  onClose,
  onConfirm,
  confirmText = "Confirm",
  footer,
  closeButton,
  maxWidth = "400px",
  children,
}: Props) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  // What had the focus before it opened, read before an autoFocus inside
  const [opener] = useState(() => document.activeElement);

  // Takes the focus, so Escape reaches it, and gives it back on close.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [opener]);

  const actions =
    footer ??
    (onConfirm && (
      <>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="accent" onClick={onConfirm}>
          {confirmText}
        </Btn>
      </>
    ));

  return (
    <div className={styles.backdrop}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={styles.card}
        style={{ maxWidth }}
        onKeyDown={(e) => {
          if (e.key === "Tab") keepTab(e);
          if (e.key !== "Escape") return;
          // Only the innermost dialog closes, e.g. a picker over a modal
          e.stopPropagation();
          onClose();
        }}
      >
        <div className={styles.header}>
          <h3 id={titleId} className={styles.title}>
            {title}
          </h3>
          {closeButton && (
            <Btn variant="icon" title="Close" onClick={onClose}>
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

        {actions && <div className={styles.footer}>{actions}</div>}
      </div>
    </div>
  );
}
