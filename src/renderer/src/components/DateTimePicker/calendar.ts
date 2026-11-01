// Days are "YYYY-MM-DD", the value's format, read and written as local dates

export const pad = (n: number) => String(n).padStart(2, "0");

export const toIso = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export function fromIso(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function addDays(iso: string, days: number) {
  const date = fromIso(iso);
  date.setDate(date.getDate() + days);
  return toIso(date);
}

// The same day in another month, or its last day when it's shorter
export function addMonths(iso: string, months: number) {
  const date = fromIso(iso);
  const year = date.getFullYear();
  const month = date.getMonth() + months;
  const last = new Date(year, month + 1, 0).getDate();
  return toIso(new Date(year, month, Math.min(date.getDate(), last)));
}

type WeekInfo = { firstDay: number };

/** The language's first day of the week, 0 for Sunday as `getDay` counts. */
export function firstDayOfWeek(language: string) {
  // getWeekInfo() in newer engines, the weekInfo getter in older ones
  const locale = new Intl.Locale(language) as Intl.Locale & {
    getWeekInfo?: () => WeekInfo;
    weekInfo?: WeekInfo;
  };
  const info = locale.getWeekInfo?.() ?? locale.weekInfo;
  if (info) return info.firstDay % 7;
  return locale.language === "en" ? 0 : 1;
}

/** The 6 weeks shown for the month of `iso`, from the week the 1st is in. */
export function monthWeeks(iso: string, weekStart: number) {
  const date = fromIso(iso);
  const year = date.getFullYear();
  const month = date.getMonth();
  const offset = (new Date(year, month, 1).getDay() - weekStart + 7) % 7;
  return Array.from({ length: 6 }, (_, week) =>
    Array.from({ length: 7 }, (_, day) =>
      toIso(new Date(year, month, 1 - offset + week * 7 + day)),
    ),
  );
}

export function uses12Hours(language: string) {
  const { hourCycle } = new Intl.DateTimeFormat(language, {
    hour: "numeric",
  }).resolvedOptions();
  return hourCycle === "h11" || hourCycle === "h12";
}

/** The language's names for the morning and the afternoon, "AM" and "PM". */
export function dayPeriods(language: string) {
  const format = new Intl.DateTimeFormat(language, {
    hour: "numeric",
    hourCycle: "h12",
  });
  return [0, 12].map(
    (hour) =>
      format
        .formatToParts(new Date(2000, 0, 1, hour))
        .find((part) => part.type === "dayPeriod")?.value ?? "",
  );
}

/** The value as the trigger shows it, null without a date. */
export function formatValue(
  language: string,
  { date, time }: { date: string; time: string },
) {
  if (!date) return null;
  const shown = fromIso(date);
  if (!time) {
    return new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(
      shown,
    );
  }
  const [hours, minutes] = time.split(":").map(Number);
  shown.setHours(hours, minutes);
  return new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(shown);
}
