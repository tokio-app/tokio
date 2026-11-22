import { TIMER_ACTIONS, TimerSettingsSchema } from "@/common/schemas";
import { APP_EVENTS, type Gifter } from "@/common/types";
import {
  GIFT_CURRENCIES,
  GIFT_CURRENCY,
  type GiftCurrency,
  platformOf,
  viewerMatcher,
} from "@/common/util";
import { MAX_FANS } from "@/services/fans";
import { z } from "zod";
import { fail, invokeOk, ok } from "../common";
import {
  DESTROY,
  defineKind,
  defineSection,
  defineTool,
  type Handler,
  type Kinds,
  READ,
  type Sections,
  type ToolDef,
  WRITE,
} from "../defs";

const iso = (ms: number) => new Date(ms).toISOString();

// The clock now: the timer's state, as get_status gives it
const timerState = ({ timerService }: Handler) => {
  const { status, remaining } = timerService.get().state;
  return { status, remainingSeconds: Math.round(remaining / 1000) };
};

// Viewer names are viewer data, in their own fields. No pictures. The
// amount is named after its currency, never added to another's.
const gifterRow =
  (currency: GiftCurrency) =>
  ({ username, handle, coins, gifts, giftedAt }: Gifter) => ({
    nickname: username,
    handle,
    [currency]: coins,
    gifts,
    lastGiftAt: iso(giftedAt),
  });

const paidIn = (currency: GiftCurrency) => (gifter: Gifter) =>
  GIFT_CURRENCY[platformOf(gifter)] === currency;

/**
 * A date or date-time in ms, or undefined when there's none. A day alone
 * is this PC's midnight, as Coin stats reads one, not UTC's.
 */
function toMs(value: string | undefined): number | undefined | null {
  if (value === undefined) return undefined;
  const ms = Date.parse(
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00` : value,
  );
  return Number.isNaN(ms) ? null : ms;
}

const changedProfile = () =>
  fail("Another profile loaded while this ran. Ask again.");

export const sections: Sections = {
  timer: defineSection({
    schema: TimerSettingsSchema.strict(),
    // From the timer, which holds the profile's settings ahead of its file
    read: ({ timerService }) =>
      TimerSettingsSchema.parse(timerService.get().settings),
    write: async (handler, values) => {
      // Its handler replies nothing: the timer pushes TIMER itself
      const { error } = await invokeOk(handler, APP_EVENTS.SET_TIMER_SETTINGS, {
        settings: values,
      });
      return error ?? ok({ saved: true, timer: timerState(handler) });
    },
    notes:
      "The active profile's countdown timer (Tools → Countdown), a subathon clock viewers add time to. start is the minutes it starts from and goes back to on reset; cap the minutes added time stops at (0, no limit); multiplier multiplies every trigger's seconds. seconds holds what each event adds: coin per coin of TikTok's gifts, kick per Kick of Kick's, likes every likes_every likes, superfan, follow, share and chat (0 leaves one out); chat counts only messages with chat.keyword, once per viewer every chat.cooldown seconds. look sets its overlay at http://tokio-app.local:37891/timer/ (colors #rrggbb or #rrggbbaa; names empty for the app language's). The timer tool starts and adjusts it.",
  }),
};

export const kinds: Kinds = {
  fans: defineKind({
    notes:
      "The fans the active profile has seen in its LIVEs, the highest fan levels first, then the most recently seen. query matches the nickname or @handle. They can't be removed.",
    list: ({ fansService }, { query, limit }) => {
      const found = fansService
        .list(MAX_FANS)
        .filter(viewerMatcher(query ?? ""));
      return ok({
        total: found.length,
        fans: found
          .slice(0, limit)
          .map(({ username, handle, fanLevel, superfan, seenAt }) => ({
            nickname: username,
            handle,
            fanLevel,
            superfan,
            lastSeenAt: iso(seenAt),
          })),
      });
    },
  }),
  lives: defineKind({
    notes:
      "The active profile's finished LIVEs (Tools → Gift stats), newest first; the one going on joins when it ends. The id is when it started, in ms. query matches the @username Tokio connected to. coins are TikTok's and kicks Kick's, never added together; gifts counts every platform's. get gives its top 50 gifters in each currency. Removing one also takes its gifts out of the all-time ranking; it can't be undone.",
    list: ({ historyService }, { query, limit }) => {
      const wanted = query?.trim().replace(/^@/, "").toLowerCase();
      const found = historyService
        .getHistory()
        .lives.filter(
          (l) => !wanted || l.username.toLowerCase().includes(wanted),
        );
      return ok({
        total: found.length,
        lives: found
          .slice(0, limit)
          .map(({ username, startedAt, endedAt, coins, kicks, gifts }) => ({
            id: String(startedAt),
            username,
            startedAt: iso(startedAt),
            endedAt: iso(endedAt),
            coins,
            kicks,
            gifts,
          })),
      });
    },
    get: async ({ historyService }, id) => {
      const live = await historyService.getLive(Number(id));
      if (!live) {
        return fail(
          `There's no LIVE ${id} or it can't be read: list lives gives the ids.`,
        );
      }
      return ok({
        id,
        username: live.username,
        startedAt: iso(live.startedAt),
        endedAt: iso(live.endedAt),
        coins: live.coins,
        kicks: live.kicks,
        gifts: live.gifts,
        totalGifters: live.gifters.length,
        gifters: Object.fromEntries(
          GIFT_CURRENCIES.map((currency) => [
            currency,
            live.gifters
              .filter(paidIn(currency))
              .slice(0, 50)
              .map(gifterRow(currency)),
          ]),
        ),
      });
    },
    remove: async (handler, id) => {
      const startedAt = Number(id);
      const known = handler.historyService
        .getHistory()
        .lives.some((l) => l.startedAt === startedAt);
      if (!known)
        return fail(`There's no LIVE ${id}: list lives gives the ids.`);
      const { error } = await invokeOk(handler, APP_EVENTS.DELETE_LIVE, {
        startedAt,
      });
      return error ?? ok("Deleted.");
    },
  }),
};

const TimerInput = z
  .object({
    action: z.enum([...TIMER_ACTIONS, "add", "remove"]),
    seconds: z.number().positive().optional(),
  })
  .strict();

const GiftersInput = z
  .object({
    from: z.string().optional(),
    to: z.string().optional(),
    query: z.string().optional(),
    currency: z.enum(GIFT_CURRENCIES).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();

export const tools: ToolDef<any>[] = [
  defineTool({
    name: "timer",
    title: "Countdown timer",
    description:
      "Drives the active profile's countdown timer. start counts down (from the starting time, or where it was), pause holds it (events still add time), stop holds it and takes no more time, reset goes back to the starting time. add and remove change the clock by `seconds`, except before the first start. Returns the timer's status and the seconds left.",
    input: TimerInput,
    annotations: WRITE,
    run: async (handler, { action, seconds }) => {
      if (action === "add" || action === "remove") {
        if (seconds === undefined)
          return fail("Give the seconds to add or remove.");
        // The timer ignores it while idle, which would read as done
        if (handler.timerService.get().state.status === "idle") {
          return fail(
            "The countdown hasn't started, so there's no clock to change. Start it first, or change its starting time in the timer section.",
          );
        }
        const { error } = await invokeOk(handler, APP_EVENTS.ADJUST_TIMER, {
          seconds: action === "add" ? seconds : -seconds,
        });
        return error ?? ok(timerState(handler));
      }
      const { error } = await invokeOk(handler, APP_EVENTS.TIMER_CONTROL, {
        action,
      });
      return error ?? ok(timerState(handler));
    },
  }),
  defineTool({
    name: "get_gifters",
    title: "Top gifters",
    description:
      "The active profile's top gifters over its finished LIVEs in one currency, coins (TikTok's, the default) or kicks (Kick's), each with their rank among that currency's gifters, what they sent in it and their gifts, plus the dates' totals: coins, kicks and every platform's gifts, never added together. from (included) and to (left out) are ISO dates or date-times; a date alone is midnight on this PC, and leaving both out means all time. query keeps the gifters whose nickname or @handle has it, ranks kept. The LIVE going on isn't counted until it ends: get_activity has its top gifters.",
    input: GiftersInput,
    annotations: READ,
    run: async (
      { historyService },
      { from, to, query, currency = "coins", limit = 50 },
    ) => {
      const range = { from: toMs(from), to: toMs(to) };
      if (range.from === null || range.to === null) {
        return fail(
          "from and to must be ISO dates, like 2026-11-01 or 2026-11-01T18:00:00Z.",
        );
      }
      const dates = { from: range.from, to: range.to };
      const totals = await historyService.getTotals(dates);
      if (!totals) return changedProfile();
      const gifters = await historyService.getGifters({ ...dates, query });
      if (!gifters) return changedProfile();
      return ok({
        currency,
        totals,
        gifters: gifters
          .filter(paidIn(currency))
          .slice(0, limit)
          .map((g) => ({ rank: g.rank, ...gifterRow(currency)(g) })),
      });
    },
  }),
  defineTool({
    name: "clear_history",
    title: "Clear LIVE history",
    description:
      "Deletes every LIVE the active profile kept and its gifters' all-time ranking (Tools → Gift stats). A LIVE going on carries on. It can't be undone: ask the streamer first.",
    input: z.object({}).strict(),
    annotations: DESTROY,
    run: async (handler) => {
      const { error } = await invokeOk(
        handler,
        APP_EVENTS.CLEAR_LIVES,
        undefined,
      );
      return error ?? ok("Cleared.");
    },
  }),
];
