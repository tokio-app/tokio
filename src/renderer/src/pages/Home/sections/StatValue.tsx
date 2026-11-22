import { formatMoney, formatStat, NO_MONEY } from "@/helper";
import { useLanguage, useT } from "@/ui/i18n";

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
        {NO_MONEY}
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
