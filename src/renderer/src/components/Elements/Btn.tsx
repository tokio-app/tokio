import { cx } from "@/helper/cx";
import { ComponentProps } from "react";
import styles from "./elements.module.css";
import { Spinner } from "./Spinner";

type Props = {
  // default: outlined, accent: filled call to action, icon: bare icon
  variant?: "default" | "accent" | "icon";
  size?: "md" | "lg";
  // Highlighted, e.g. a sound that is playing
  active?: boolean;
  // Pulses while active
  pulse?: boolean;
  // Shows a spinner and ignores clicks
  loading?: boolean;
} & ComponentProps<"button">;

export function Btn({
  variant = "default",
  size = "md",
  active,
  pulse,
  loading,
  className,
  children,
  type = "button",
  onClick,
  ...rest
}: Props) {
  return (
    <button
      type={type}
      aria-busy={loading || undefined}
      className={cx(
        styles.btn,
        variant === "accent" && styles.btn_accent,
        variant === "icon" && styles.btn_icon,
        size === "lg" && styles.btn_lg,
        active && styles.btn_active,
        active && pulse && styles.btn_pulse,
        className,
      )}
      // CSS only holds the pointer back, Enter and Space still click it.
      // Stopping the click also keeps a submit button from submitting.
      onClick={(e) => {
        if (loading) e.preventDefault();
        else onClick?.(e);
      }}
      {...rest}
    >
      {loading ? <Spinner /> : children}
    </button>
  );
}
