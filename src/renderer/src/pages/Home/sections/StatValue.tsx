import { formatMoney, formatStat } from "@/helper";
import { useLanguage, useT } from "@/ui/i18n";

// Stands in for dollars before the exchange rates load
const UNKNOWN = "—";

// Short, with the exact number on hover, as the language writes them. money
// is US dollars, and null shows a dash until they're known.
export function StatValue({
  value,
  money,
  className,
}: {
  value: number | null;
  money?: boolean;
  className: string;
}) {
  const t = useT();
  const language = useLanguage();
  if (value === null) {
    return (
      <span className={className} title={t("home.totals.noRates")}>
        {UNKNOWN}
      </span>
    );
  }
  const { short, full } = (money ? formatMoney : formatStat)(value, language);
  return (
    <span className={className} title={full}>
      {short}
    </span>
  );
}
