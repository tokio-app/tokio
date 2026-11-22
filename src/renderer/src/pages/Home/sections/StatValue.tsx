import { formatStat } from "@/helper";
import { useLanguage } from "@/ui/i18n";

// Short, with the exact number on hover, as the language writes them
export function StatValue({
  value,
  className,
}: {
  value: number;
  className: string;
}) {
  const language = useLanguage();
  const { short, full } = formatStat(value, language);
  return (
    <span className={className} title={full}>
      {short}
    </span>
  );
}
