import { formatDuration, formatStat } from "@/helper";
import { useLanguage, useT } from "@/ui/i18n";
import { useState } from "react";
import styles from "../home.module.css";
import { chartPoints, nearestIndex } from "../helper";

interface Props {
  // Each minute's highest count since the LIVE started, the current one last
  viewers: number[];
  // TikTok's count now, which stands in for the current minute
  liveCount: number;
}

// One reading a minute, Y from 0 to the peak. The dot, the crosshair and the
// tooltip are HTML placed by %, since the SVG stretches and would turn
// circles oval. Hover is pointer only: the hero and Peak say the numbers.
export function ViewersChart({ viewers, liveCount }: Props) {
  const t = useT();
  const language = useLanguage();
  const [hovered, setHovered] = useState<number | null>(null);
  const values = [...viewers.slice(0, -1), liveCount];
  const points = chartPoints(values);
  const now = points[points.length - 1];
  const line = points.map(({ x, y }) => `${x},${y}`).join(" ");
  const peak = Math.max(...values);
  const point = hovered === null ? undefined : points[hovered];

  return (
    <div className={styles.chart}>
      <p className={styles.peak}>
        {t("home.pulse.peak")}{" "}
        <span
          className={styles.peak_value}
          title={formatStat(peak, language).full}
        >
          {formatStat(peak, language).short}
        </span>
      </p>

      <div
        className={styles.plot}
        role="img"
        aria-label={t("home.pulse.chart")}
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const ratio = box.width ? (e.clientX - box.left) / box.width : 1;
          setHovered(nearestIndex(ratio, values.length));
        }}
        onPointerLeave={() => setHovered(null)}
      >
        <svg
          className={styles.plot_svg}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polygon
            className={styles.plot_area}
            points={`${points[0].x},100 ${line} ${now.x},100`}
          />
          <line
            className={styles.plot_base}
            x1="0"
            y1="100"
            x2="100"
            y2="100"
          />
          <polyline className={styles.plot_line} points={line} />
        </svg>

        <span
          className={styles.plot_now}
          style={{ left: `${now.x}%`, top: `${now.y}%` }}
        />

        {point && hovered !== null && (
          <>
            <span
              className={styles.crosshair}
              style={{ left: `${point.x}%` }}
            />
            <span
              className={styles.tooltip}
              // Toward the middle, so it never leaves the chart
              style={{
                left: `${point.x}%`,
                translate: point.x > 50 ? "calc(-100% - 8px)" : "8px",
              }}
            >
              <span className={styles.tooltip_value}>
                {formatStat(values[hovered], language).full}
              </span>
              <span className={styles.tooltip_time}>
                {formatDuration(hovered * 60_000)}
              </span>
            </span>
          </>
        )}
      </div>
    </div>
  );
}
