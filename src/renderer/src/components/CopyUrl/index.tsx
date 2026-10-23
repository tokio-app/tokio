import { useEffect, useState } from "react";
import { FaRegCopy } from "react-icons/fa";
import { FiCheck } from "react-icons/fi";
import { Btn } from "../Elements";
import styles from "./copyurl.module.css";

// A field showing the URL, which copies it when clicked.
export function CopyUrl({ url }: { url: string }) {
  // Shows a check for a moment after copying
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Btn
      title="Copy URL"
      className={styles.url}
      onClick={() => {
        void navigator.clipboard.writeText(url);
        setCopied(true);
      }}
    >
      <span className={styles.url_text}>{url}</span>
      {copied ? (
        <FiCheck size={16} className={styles.copied} />
      ) : (
        <FaRegCopy size={16} />
      )}
    </Btn>
  );
}
