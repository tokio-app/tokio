import { cx } from "@/helper/cx";
import { ReactNode, useId } from "react";
import styles from "./page.module.css";

type PageProps = {
  // wide fits tables such as the alerts list
  width?: "default" | "wide";
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
          <div>
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
 * A labelled control. The label names the field as a group.
 */
export function Field({ label, hint, className, children }: FieldProps) {
  const id = useId();
  return (
    <div
      className={cx(styles.field, className)}
      role={label ? "group" : undefined}
      aria-labelledby={label ? id : undefined}
    >
      {label && (
        <label id={id} className={styles.field_label}>
          {label}
          {hint && <span className={styles.field_hint}>{hint}</span>}
        </label>
      )}
      {children}
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
