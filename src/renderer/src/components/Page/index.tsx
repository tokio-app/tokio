import { cx } from "@/helper/cx";
import { ReactNode, useCallback, useId, useMemo, useState } from "react";
import { FieldContext } from "../Elements/useFieldControl";
import styles from "./page.module.css";

type PageProps = {
  // wide fits tables such as the alerts list; full has no max width, for an
  // editor whose canvas is the page
  width?: "default" | "wide" | "full";
  // aside puts each section's header in a column left of its content, for
  // pages of settings
  layout?: "stack" | "aside";
  children: ReactNode;
};

/**
 * Centered page column. Sections inside are separated by a divider.
 */
export function Page({
  width = "default",
  layout = "stack",
  children,
}: PageProps) {
  return (
    <div
      className={cx(
        styles.page,
        width === "wide" && styles.page_wide,
        width === "full" && styles.page_full,
        layout === "aside" && styles.page_aside,
      )}
    >
      {children}
    </div>
  );
}

type SectionProps = {
  // Without title, description and actions there's no header
  title?: ReactNode;
  description?: ReactNode;
  // Shown before the title
  icon?: ReactNode;
  // Buttons on the right of the title
  actions?: ReactNode;
  // Draws a line under the header, for a section whose content is a grid
  divider?: boolean;
  children?: ReactNode;
};

export function Section({
  title,
  description,
  icon,
  actions,
  divider,
  children,
}: SectionProps) {
  return (
    <section className={styles.section}>
      {(title || description || actions) && (
        <header
          className={cx(
            styles.section_header,
            divider && styles.section_header_divider,
          )}
        >
          <div className={styles.section_heading}>
            {title && (
              <h2 className={styles.section_title}>
                {icon}
                {title}
              </h2>
            )}
            {description && (
              <p className={styles.section_description}>{description}</p>
            )}
          </div>
          {actions && <div className={styles.section_actions}>{actions}</div>}
        </header>
      )}
      <div className={styles.section_body}>{children}</div>
    </section>
  );
}

type FieldProps = {
  label?: ReactNode;
  // Secondary text after the label, e.g. "(seconds)"
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
};

/**
 * A labelled control. The label names the field as a group, and its control
 * too when it has one Input, Textarea or Select, which clicking it focuses.
 */
export function Field({ label, hint, className, children }: FieldProps) {
  const id = useId();
  const [controls, setControls] = useState<string[]>([]);
  const claim = useCallback((control: string) => {
    setControls((all) => [...all, control]);
    return () => setControls((all) => all.filter((c) => c !== control));
  }, []);
  const control = controls.length === 1 ? controls[0] : undefined;
  const field = useMemo(
    () => ({ labelId: id, control, claim }),
    [id, control, claim],
  );

  return (
    <div
      className={cx(styles.field, className)}
      role={label ? "group" : undefined}
      aria-labelledby={label ? id : undefined}
    >
      {label && (
        <label
          id={id}
          htmlFor={control}
          className={styles.field_label}
          onClick={() => {
            // A Select is a div, which a <label for> doesn't focus
            const el = control && document.getElementById(control);
            if (el && el.getAttribute("role") === "combobox") el.focus();
          }}
        >
          {label}
          {hint && <span className={styles.field_hint}>{hint}</span>}
        </label>
      )}
      {/* Without a label, nor an outer field's either */}
      <FieldContext.Provider value={label ? field : null}>
        {children}
      </FieldContext.Provider>
    </div>
  );
}

/**
 * Two column grid of fields.
 */
export function FormGrid({ children }: { children: ReactNode }) {
  return <div className={styles.grid}>{children}</div>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className={styles.empty}>{children}</p>;
}
