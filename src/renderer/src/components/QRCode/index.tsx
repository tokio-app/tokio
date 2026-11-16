import Logo from "@/assets/logo.png";
import { encode, QrCodeDataType } from "uqr";
import styles from "./qrcode.module.css";

type Props = {
  value: string;
  // Says what it opens, for screen readers
  label: string;
};

const BORDER = 2;
// A module's corner radius: a lone module is a dot
const R = 0.5;
// The logo's room around it, in modules
const PAD = 0.5;

// A rounded rectangle, clockwise
const rounded = (x: number, y: number, w: number, h: number, r: number) =>
  `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}` +
  `a${r} ${r} 0 0 1 ${-r} ${r}h${2 * r - w}a${r} ${r} 0 0 1 ${-r} ${-r}` +
  `v${2 * r - h}a${r} ${r} 0 0 1 ${r} ${-r}z`;

// A corner rounds off only where no dark module touches it, so modules side
// by side flow together like ink, as the logo's brush strokes do
function module(x: number, y: number, dark: (x: number, y: number) => boolean) {
  const up = dark(x, y - 1);
  const down = dark(x, y + 1);
  const left = dark(x - 1, y);
  const right = dark(x + 1, y);
  const tl = up || left ? 0 : R;
  const tr = up || right ? 0 : R;
  const br = down || right ? 0 : R;
  const bl = down || left ? 0 : R;
  return (
    `M${x + tl} ${y}H${x + 1 - tr}${tr ? `a${R} ${R} 0 0 1 ${R} ${R}` : ""}` +
    `V${y + 1 - br}${br ? `a${R} ${R} 0 0 1 ${-R} ${R}` : ""}` +
    `H${x + bl}${bl ? `a${R} ${R} 0 0 1 ${-R} ${-R}` : ""}` +
    `V${y + tl}${tl ? `a${R} ${R} 0 0 1 ${R} ${-R}` : ""}z`
  );
}

// The three corner squares cameras look for, as rings: their 1:1:3:1:1
// widths through the middle stay exact
const eye = (x: number, y: number) =>
  rounded(x, y, 7, 7, 2) +
  rounded(x + 1, y + 1, 5, 5, 1) +
  rounded(x + 2, y + 2, 3, 3, 0.9);

/**
 * A QR code with Tokio's logo in the middle, dark on white in any theme since
 * phones' cameras need the contrast. Q lets a quarter of the code go unread,
 * so the logo can cover the middle: every IPv4 link fits version 5 or 6,
 * whose only alignment pattern is in the bottom-right corner.
 */
export function QRCode({ value, label }: Props) {
  const { data, types, size } = encode(value, { ecc: "Q", border: BORDER });
  const count = size - 2 * BORDER;
  // About a quarter of the width, odd so it sits on the middle module
  const box = Math.round(count * 0.24) | 1;
  const start = BORDER + (count - box) / 2;
  const inLogo = (x: number, y: number) =>
    x >= start && x < start + box && y >= start && y < start + box;
  // The eyes are drawn whole, apart from the other modules. The light border
  // keeps every module's neighbors inside the grid.
  const dark = (x: number, y: number) =>
    data[y][x] && types[y][x] !== QrCodeDataType.Position && !inLogo(x, y);

  const modules = data
    .flatMap((row, y) =>
      row.map((_, x) => (dark(x, y) ? module(x, y, dark) : "")),
    )
    .join("");
  const far = size - BORDER - 7;
  const eyes = eye(BORDER, BORDER) + eye(far, BORDER) + eye(BORDER, far);

  return (
    <svg
      role="img"
      aria-label={label}
      className={styles.qr}
      viewBox={`0 0 ${size} ${size}`}
    >
      <rect width={size} height={size} className={styles.light} />
      <path d={modules} className={styles.dark} />
      <path d={eyes} className={styles.dark} fillRule="evenodd" />
      <image
        href={Logo}
        x={start + PAD}
        y={start + PAD}
        width={box - 2 * PAD}
        height={box - 2 * PAD}
      />
    </svg>
  );
}
