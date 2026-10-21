import { cx } from "@/helper/cx";
import styles from "./elements.module.css";

type Props = {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  // Shows the value above the right end of the track
  showValue?: boolean;
  className?: string;
  "aria-label"?: string;
};

export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
  showValue,
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
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {showValue && <span className={styles.slider_value}>{value}</span>}
    </div>
  );
}
