import { cx } from "@/helper/cx";
import { ComponentProps, TextareaHTMLAttributes } from "react";
import styles from "./elements.module.css";
import { useFieldControl } from "./useFieldControl";

export function Input({
  className,
  type = "text",
  ...rest
}: ComponentProps<"input">) {
  const { id } = useFieldControl(rest.id);
  return (
    <input
      type={type}
      className={cx(styles.input, className)}
      {...rest}
      id={id}
    />
  );
}

export function Textarea({
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { id } = useFieldControl(rest.id);
  return (
    <textarea
      className={cx(styles.input, styles.textarea, className)}
      {...rest}
      id={id}
    />
  );
}
