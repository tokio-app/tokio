import styles from "./elements.module.css";

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={styles.spinner}
      style={{ width: size, height: size }}
    />
  );
}
