import { TestOverlay } from "@/common/schemas";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  Fan,
  TimerData,
} from "@/common/types";
import { fan, liveSummary, profileReply, timerReply } from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { renderApp } from "@test/render";
import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const OCT_31 = new Date(2026, 9, 31, 20).getTime();
const OCT_24 = new Date(2026, 9, 24, 20).getTime();

const CLOCK: TestOverlay = { id: "4f9c2a", name: "Clock" };

const timer = (recipe?: (data: TimerData) => void) =>
  send(APP_EVENTS_RESPONSE.TIMER, timerReply(recipe));
const lives = (...data: ReturnType<typeof liveSummary>[]) =>
  send(APP_EVENTS_RESPONSE.LIVES, { data: { lives: data, gifters: [] } });
const fans = (...data: Fan[]) => send(APP_EVENTS_RESPONSE.FANS, { data });
const testOverlays = (...data: TestOverlay[]) =>
  send(APP_EVENTS_RESPONSE.GET_TEST_OVERLAYS, { success: true, data });

const page = () => within(screen.getByRole("main"));
// A tool's row, a link named by the tool
const row = (name: string) => page().getByRole("link", { name });
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe("Tools", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists the tools in order, each a link to its page", async () => {
    await renderApp("/tools");
    const names = ["Countdown timer", "Coin stats", "Fans", "Test overlays"];

    const links = page().getAllByRole("link");
    expect(links).toEqual(names.map(row));
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/tools/timer",
      "/tools/coin-stats",
      "/tools/fans",
      "/tools/test-overlays",
    ]);
    expect(row("Countdown timer")).toHaveAccessibleDescription(
      "A countdown viewers add time to.",
    );
  });

  it("asks main for what each tool holds", async () => {
    await renderApp("/tools");

    expect(sent(APP_EVENTS.GET_TIMER)).toHaveLength(1);
    expect(sent(APP_EVENTS.GET_LIVES)).toHaveLength(1);
    expect(sent(APP_EVENTS.GET_FANS)).toHaveLength(1);
    expect(sent(APP_EVENTS.GET_TEST_OVERLAYS)).toHaveLength(1);
  });

  it("shows nothing on the right until main sends it", async () => {
    await renderApp("/tools");

    expect(row("Countdown timer")).toHaveTextContent(
      /^Countdown timerA countdown viewers add time to\.$/,
    );
    expect(row("Fans")).toHaveTextContent(
      /^FansViewers with a fan level, highest first\.$/,
    );
  });

  it("shows each tool's value", async () => {
    await renderApp("/tools");

    await timer();
    await lives(
      liveSummary(OCT_31, { coins: 1234 }),
      liveSummary(OCT_24, { coins: 50 }),
    );
    await fans(fan("Jules", 32), fan("Sofi", 28));
    await testOverlays(CLOCK);

    expect(row("Countdown timer")).toHaveAccessibleDescription(
      "A countdown viewers add time to. 01:00:00 Ready",
    );
    // The newest LIVE's
    expect(row("Coin stats")).toHaveAccessibleDescription(
      "The coins and gifts of every LIVE, and who sent them. 1,234 coins on Oct 31, 2026",
    );
    expect(row("Fans")).toHaveAccessibleDescription(
      "Viewers with a fan level, highest first. 2 fans",
    );
    expect(row("Test overlays")).toHaveAccessibleDescription(
      "Send test events to an overlay you're building. 1 test overlay",
    );
  });

  it("counts one coin, one fan, and no test overlays", async () => {
    await renderApp("/tools");

    await lives(liveSummary(OCT_31, { coins: 1 }));
    await fans(fan("Jules", 32));
    await testOverlays();

    expect(
      within(row("Coin stats")).getByText("coin on Oct 31, 2026"),
    ).toBeVisible();
    expect(within(row("Fans")).getByText("fan")).toBeVisible();
    expect(within(row("Test overlays")).getByText("0")).toBeVisible();
    expect(
      within(row("Test overlays")).getByText("test overlays"),
    ).toBeVisible();
  });

  it("says when there are no LIVEs yet, with no number", async () => {
    await renderApp("/tools");

    await lives();

    expect(row("Coin stats")).toHaveAccessibleDescription(
      "The coins and gifts of every LIVE, and who sent them. No LIVEs yet",
    );
  });

  it("ticks the time left only while the timer runs", async () => {
    vi.useFakeTimers();
    await renderApp("/tools");
    const clock = () => within(row("Countdown timer"));

    await timer((t) => {
      t.state = { status: "running", remaining: 10_000 };
    });
    expect(clock().getByText("00:00:10")).toBeVisible();
    expect(clock().getByText("Running")).toBeVisible();
    await wait(1000);
    expect(clock().getByText("00:00:09")).toBeVisible();

    await timer((t) => {
      t.state = { status: "paused", remaining: 8_500 };
    });
    await wait(5000);
    expect(clock().getByText("00:00:09")).toBeVisible();
    expect(clock().getByText("Paused")).toBeVisible();
  });

  it("warms the timer's row only while it runs", async () => {
    await renderApp("/tools");

    await timer();
    expect(row("Countdown timer").className).not.toMatch(/tool_live/);

    await timer((t) => {
      t.state = { status: "running", remaining: 10_000 };
    });
    expect(row("Countdown timer").className).toMatch(/tool_live/);
    expect(row("Coin stats").className).not.toMatch(/tool_live/);
  });

  it("shows the starting time while idle", async () => {
    await renderApp("/tools");

    await timer((t) => {
      t.settings.start = 90;
      t.state = { status: "idle", remaining: 60 * 60_000 };
    });

    expect(within(row("Countdown timer")).getByText("01:30:00")).toBeVisible();
  });

  it("asks for the LIVEs and the fans again when the profile changes", async () => {
    await renderApp("/tools");
    await lives(liveSummary(OCT_31, { coins: 1234 }));

    await send(APP_EVENTS_RESPONSE.GET_PROFILE, { success: false });
    expect(sent(APP_EVENTS.GET_LIVES)).toHaveLength(1);

    await send(APP_EVENTS_RESPONSE.GET_PROFILE, profileReply());
    expect(sent(APP_EVENTS.GET_LIVES)).toHaveLength(2);
    expect(sent(APP_EVENTS.GET_FANS)).toHaveLength(2);

    await lives();
    expect(within(row("Coin stats")).getByText("No LIVEs yet")).toBeVisible();
  });

  it.each([
    ["Countdown timer", "/tools/timer"],
    ["Coin stats", "/tools/coin-stats"],
    ["Fans", "/tools/fans"],
    ["Test overlays", "/tools/test-overlays"],
  ])("opens %s", async (name, path) => {
    const { user, router } = await renderApp("/tools");

    await user.click(row(name));

    await waitFor(() => expect(router.state.location.pathname).toBe(path));
  });
});
