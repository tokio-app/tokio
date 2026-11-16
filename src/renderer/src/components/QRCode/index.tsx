import { encode } from "uqr";
import styles from "./qrcode.module.css";

type Props = {
  value: string;
  // Says what it opens, for screen readers
  label: string;
};

// A QR code drawn as one path of 1×1 squares, dark on white in any theme
// since phones' cameras need the contrast
export function QRCode({ value, label }: Props) {
  const { data, size } = encode(value, { ecc: "M", border: 2 });
  const path = data
    .flatMap((row, y) =>
      row.map((dark, x) => (dark ? `M${x} ${y}h1v1h-1z` : "")),
    )
    .join("");

  return (
    <svg
      role="img"
      aria-label={label}
      className={styles.qr}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} className={styles.light} />
      <path d={path} className={styles.dark} />
    </svg>
  );
}
