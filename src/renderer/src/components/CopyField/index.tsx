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

// Copies a value, and says so with a check for a moment
function useCopied(value: string) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = () => {
    void navigator.clipboard.writeText(value);
    setCopied(true);
  };
  return { copied, copy };
}

const CopyIcon = ({ copied, size }: { copied: boolean; size: number }) =>
  copied ? (
    <FiCheck size={size} className={styles.copied} />
  ) : (
    <FaRegCopy size={size} />
  );

// A field showing a value, like a URL or an address, which copies it when
// clicked.
export function CopyField({ value, title, code, display }: Props) {
  const { copied, copy } = useCopied(value);

  return (
    <Btn
      title={title}
      className={cx(styles.field, code && styles.code)}
      onClick={copy}
    >
      <span className={styles.value}>{display ?? value}</span>
      <CopyIcon copied={copied} size={16} />
    </Btn>
  );
}

// The same as an icon button, for a row's actions
export function CopyButton({
  value,
  title,
  disabled,
}: {
  value: string;
  // Says what it copies
  title: string;
  disabled?: boolean;
}) {
  const { copied, copy } = useCopied(value);

  return (
    <Btn variant="icon" title={title} disabled={disabled} onClick={copy}>
      <CopyIcon copied={copied} size={18} />
    </Btn>
  );
}
