import { cx } from "@/helper/cx";
import { ComponentProps, TextareaHTMLAttributes } from "react";
import styles from "./elements.module.css";

export function Input({
  className,
  type = "text",
  ...rest
}: ComponentProps<"input">) {
  return (
    <input type={type} className={cx(styles.input, className)} {...rest} />
  );
}

export function Textarea({
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cx(styles.input, styles.textarea, className)}
      {...rest}
    />
  );
}
