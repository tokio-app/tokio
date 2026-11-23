import { TIMER_ACTIONS, TimerSettingsSchema } from "@/common/schemas";
import {
  APP_EVENTS,
  type Gifter,
  type HistoryTotals,
  type Platform,
  PLATFORMS,
} from "@/common/types";
import {
  PLATFORM_CURRENCY,
  platformOf,
  platformParts,
  viewerMatcher,
} from "@/common/util";
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
// amount is named after its platform's currency, never added to another's.
const gifterRow = (gifter: Gifter) => ({
  nickname: gifter.username,
  handle: gifter.handle,
  [PLATFORM_CURRENCY[platformOf(gifter)]]: gifter.coins,
  gifts: gifter.gifts,
  giftSubs: gifter.giftSubs,
  lastGiftAt: iso(gifter.giftedAt),
});

const on = (platform: Platform) => (gifter: Gifter) =>
  platformOf(gifter) === platform;

// Each platform's part, its amount named after its currency
const platformTotals = (parts: Partial<Record<Platform, HistoryTotals>>) =>
  Object.fromEntries(
    PLATFORMS.flatMap((platform) => {
      const part = parts[platform];
      if (!part) return [];
      const { amount, gifts, giftSubs } = part;
      return [
        [platform, { [PLATFORM_CURRENCY[platform]]: amount, gifts, giftSubs }],
      ];
    }),
  );

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
      "The fans the active profile has seen in its LIVEs, each with its platform: TikTok's fan club by fanLevel, highest first; Twitch's and Kick's subscribers and YouTube's channel members by months subscribed (missing when unknown), most first; then the most recently seen. Each platform's fans come together, in the order tiktok, twitch, youtube, kick. superfan is TikTok's Super Fan, and always true on the other platforms. query matches the nickname or @handle. They can't be removed.",
    list: ({ fansService }, { query, limit }) => {
      const found = fansService.all().filter(viewerMatcher(query ?? ""));
      return ok({
        total: found.length,
        fans: found.slice(0, limit).map((fan) => {
          const platform = platformOf(fan);
          return {
            nickname: fan.username,
            handle: fan.handle,
            platform,
            ...(platform === "tiktok"
              ? { fanLevel: fan.fanLevel }
              : fan.months && { months: fan.months }),
            superfan: fan.superfan,
            lastSeenAt: iso(fan.seenAt),
          };
        }),
      });
    },
  }),
  lives: defineKind({
    notes:
      "The active profile's finished LIVEs (Tools → LIVE history), newest first; the one going on joins when it ends. The id is when it started, in ms. query matches the @username Tokio connected to. platforms has each platform the LIVE was on: what viewers spent there in its own currency (coins on TikTok, kicks on Kick, bits on Twitch, usd for YouTube's Super Chats in US dollars), its gifts and its gifted subs (giftSubs). Currencies are never added together; gifts counts every platform's. get gives its top 50 gifters on each platform. Removing one also takes its gifts out of the all-time ranking; it can't be undone.",
    list: ({ historyService }, { query, limit }) => {
      const wanted = query?.trim().replace(/^@/, "").toLowerCase();
      const found = historyService
        .getHistory()
        .lives.filter(
          (l) => !wanted || l.username.toLowerCase().includes(wanted),
        );
      return ok({
        total: found.length,
        lives: found.slice(0, limit).map((live) => ({
          id: String(live.startedAt),
          username: live.username,
          startedAt: iso(live.startedAt),
          endedAt: iso(live.endedAt),
          gifts: live.gifts,
          platforms: platformTotals(platformParts(live)),
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
      const parts = platformParts(live);
      return ok({
        id,
        username: live.username,
        startedAt: iso(live.startedAt),
        endedAt: iso(live.endedAt),
        gifts: live.gifts,
        platforms: platformTotals(parts),
        totalGifters: live.gifters.length,
        // In each platform's order
        gifters: Object.fromEntries(
          PLATFORMS.filter((p) => parts[p] || live.gifters.some(on(p))).map(
            (platform) => [
              platform,
              live.gifters.filter(on(platform)).slice(0, 50).map(gifterRow),
            ],
          ),
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
    platform: z.enum(PLATFORMS).optional(),
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
      "The active profile's top gifters over its finished LIVEs on one platform (tiktok, the default, twitch, youtube or kick), the most spent first, then the most gifted subs. Each has their rank among that platform's gifters, what they spent in its currency (coins on TikTok, bits on Twitch, usd for YouTube's Super Chats in US dollars, kicks on Kick), their gifts and their gifted subs (giftSubs). totals has each platform's in the dates, each in its own currency, never added together. from (included) and to (left out) are ISO dates or date-times; a date alone is midnight on this PC, and leaving both out means all time. query keeps the gifters whose nickname or @handle has it, ranks kept. The LIVE going on isn't counted until it ends: get_activity has its top gifters.",
    input: GiftersInput,
    annotations: READ,
    run: async (
      { historyService },
      { from, to, query, platform = "tiktok", limit = 50 },
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
        platform,
        totals: platformTotals(totals.platforms),
        gifters: gifters
          .filter(on(platform))
          .slice(0, limit)
          .map((g) => ({ rank: g.rank, ...gifterRow(g) })),
      });
    },
  }),
  defineTool({
    name: "clear_history",
    title: "Clear LIVE history",
    description:
      "Deletes every LIVE the active profile kept and its gifters' all-time ranking (Tools → LIVE history). A LIVE going on carries on. It can't be undone: ask the streamer first.",
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
