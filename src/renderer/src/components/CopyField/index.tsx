import { cx } from "@/helper/cx";
import { ReactNode, useEffect, useState } from "react";
import { FaRegCopy } from "react-icons/fa";
import { FiCheck } from "react-icons/fi";
import { Btn } from "../Elements";
import styles from "./copyfield.module.css";

type Props = {
  value: string;
  // Says what it copies
  title: string;
  // Text typed in a game, like a command: monospaced, and wraps
  code?: boolean;
  // Shown instead of the value, which is still what it copies
  display?: ReactNode;
};

// A field showing a value, like a URL or an address, which copies it when
// clicked.
export function CopyField({ value, title, code, display }: Props) {
  // Shows a check for a moment after copying
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Btn
      title={title}
      className={cx(styles.field, code && styles.code)}
      onClick={() => {
        void navigator.clipboard.writeText(value);
        setCopied(true);
      }}
    >
      <span className={styles.value}>{display ?? value}</span>
      {copied ? (
        <FiCheck size={16} className={styles.copied} />
      ) : (
        <FaRegCopy size={16} />
      )}
    </Btn>
  );
}
