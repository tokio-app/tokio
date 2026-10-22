import { cx } from "@/helper/cx";
import styles from "./elements.module.css";

type Props = {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  className?: string;
  "aria-label"?: string;
};

export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  className,
  "aria-label": ariaLabel,
}: Props) {
  return (
    <div className={cx(styles.slider_container, className)}>
      <input
        type="range"
        aria-label={ariaLabel}
        className={styles.slider}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
