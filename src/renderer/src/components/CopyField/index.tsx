import { useEffect, useState } from "react";
import { FaRegCopy } from "react-icons/fa";
import { FiCheck } from "react-icons/fi";
import { Btn } from "../Elements";
import styles from "./copyfield.module.css";

// A field showing a value, like a URL or an address, which copies it when
// clicked. `title` says what it copies.
export function CopyField({ value, title }: { value: string; title: string }) {
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
      className={styles.field}
      onClick={() => {
        void navigator.clipboard.writeText(value);
        setCopied(true);
      }}
    >
      <span className={styles.value}>{value}</span>
      {copied ? (
        <FiCheck size={16} className={styles.copied} />
      ) : (
        <FaRegCopy size={16} />
      )}
    </Btn>
  );
}
