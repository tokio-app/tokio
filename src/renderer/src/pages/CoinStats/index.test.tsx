import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  FEEDBACK_CODES,
  Gifter,
  LiveSummary,
} from "@/common/types";
import { gifter, liveSummary, profileReply } from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { renderApp, renderWithProviders } from "@test/render";
import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoinStats } from ".";

// Local times, so the dates read the same in any time zone
const FRIDAY = new Date(2026, 9, 30, 20, 14).getTime();
const SATURDAY = new Date(2026, 9, 31, 19, 0).getTime();

const friday = liveSummary(FRIDAY, {
  username: "kai_live",
  endedAt: FRIDAY + (2 * 3600 + 14 * 60 + 5) * 1000,
  coins: 12_400,
  gifts: 1203,
});
const saturday = liveSummary(SATURDAY, {
  username: "kai_live",
  endedAt: SATURDAY + 30 * 60 * 1000,
  coins: 600,
  gifts: 40,
});

const lives = (list: LiveSummary[], gifters: Gifter[] = []) =>
  send(APP_EVENTS_RESPONSE.LIVES, { data: { lives: list, gifters } });

const record = (live: LiveSummary, gifters: Gifter[]) =>
  send(APP_EVENTS_RESPONSE.LIVE, {
    success: true,
    startedAt: live.startedAt,
    data: { ...live, gifters, minutes: [] },
  });

const list = () => screen.getByRole("listbox", { name: "Your LIVEs" });
const options = () =>
  within(list())
    .getAllByRole("option")
    .map((option) => option.getAttribute("aria-label"));
const option = (name: RegExp) => within(list()).getByRole("option", { name });
const selected = () =>
  within(list())
    .getByRole("option", { selected: true })
    .getAttribute("aria-label");
// The summary's title, after the page's
const heading = () => screen.getAllByRole("heading", { level: 2 })[1];
// The value shown above a stat's label, not the currency switch's tab
const stat = (label: string) =>
  screen.getByText(label, { ignore: "[role=tab]" }).previousElementSibling;
// A LIVE's bar, scaled to the best LIVE
const bar = (name: RegExp) =>
  option(name).querySelector<HTMLElement>("[style]")?.style.width;
const kicker = (name: string, kicks: number, gifts = 1): Gifter => ({
  ...gifter(name, kicks, gifts),
  userId: `kick:${name}`,
  platform: "kick",
});
const gifterRows = (name: string) =>
  within(screen.getByRole("list", { name }))
    .getAllByRole("listitem")
    .map((row) => row.textContent);
// Picks one of a select's options, the date filter's by default
const dates = async (
  user: ReturnType<typeof renderWithProviders>["user"],
  choice: string,
  select = "Dates",
) => {
  await user.click(screen.getByRole("combobox", { name: select }));
  await user.click(screen.getByRole("option", { name: choice }));
};

describe("LIVE history", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("has a header with the page's title, also while it loads", () => {
    renderWithProviders(<CoinStats />);

    expect(
      screen.getByRole("heading", { name: "LIVE history" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Back to Tools" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });

  it("keeps the header over the dashboard", async () => {
    renderWithProviders(<CoinStats />);

    await lives([saturday, friday]);

    expect(screen.getAllByRole("heading", { level: 2 })[0]).toHaveTextContent(
      "LIVE history",
    );
    expect(list()).toBeInTheDocument();
  });

  it("goes back to Tools", async () => {
    const { user, router } = await renderApp("/tools/coin-stats");

    await user.click(screen.getByRole("button", { name: "Back to Tools" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/tools"));
  });

  it("asks main for the LIVEs", () => {
    renderWithProviders(<CoinStats />);

    expect(sent(APP_EVENTS.GET_LIVES)).toEqual([undefined]);
  });

  it("lists All time first, then the LIVEs newest first", async () => {
    renderWithProviders(<CoinStats />);

    await lives([saturday, friday]);

    expect(options()).toEqual([
      "All time, 13,000 coins",
      expect.stringMatching(
        /^Saturday, October 31, 2026 at 7:00\sPM, 600 coins$/,
      ),
      expect.stringMatching(
        /^Friday, October 30, 2026 at 8:14\sPM, 12,400 coins$/,
      ),
    ]);
    expect(option(/^Friday/)).toHaveTextContent(
      /^Oct 30, 2026.*02:14:0512\.4K$/,
    );
  });

  it("opens on the newest LIVE, and asks for its gifters", async () => {
    renderWithProviders(<CoinStats />);

    await lives([saturday, friday]);

    expect(selected()).toMatch(/^Saturday/);
    expect(heading()).toHaveTextContent("Saturday, October 31, 2026");
    expect(sent(APP_EVENTS.GET_LIVE)).toEqual([{ startedAt: SATURDAY }]);
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });

  it("starts a Spanish date's title with a capital", async () => {
    history.replaceState(null, "", "?lang=es-419");
    try {
      renderWithProviders(<CoinStats />);
      await lives([saturday]);

      expect(heading()).toHaveTextContent("Sábado, 31 de octubre de 2026");
    } finally {
      history.replaceState(null, "", "/");
    }
  });

  it("shows the selected LIVE: when, how long, whose and what it counted", async () => {
    const { user } = renderWithProviders(<CoinStats />);
    await lives([saturday, friday]);

    await user.click(option(/^Friday/));

    expect(selected()).toMatch(/^Friday/);
    expect(heading()).toHaveTextContent("Friday, October 30, 2026");
    expect(screen.getByText(/^8:14\sPM to 10:28\sPM$/)).toBeInTheDocument();
    expect(screen.getAllByText("02:14:05")).toHaveLength(2);
    expect(screen.getByText("@kai_live")).toBeInTheDocument();
    expect(stat("Coins")).toHaveTextContent("12.4K");
    expect(stat("Coins")).toHaveAttribute("title", "12,400");
    expect(stat("Gifts")).toHaveTextContent("1.2K");
    expect(sent(APP_EVENTS.GET_LIVE)).toEqual([
      { startedAt: SATURDAY },
      { startedAt: FRIDAY },
    ]);
  });

  it("leaves out the @username a LIVE doesn't have", async () => {
    renderWithProviders(<CoinStats />);
    await lives([liveSummary(SATURDAY, { username: "" })]);

    expect(heading()).toHaveTextContent("Saturday, October 31, 2026");
    expect(screen.queryByText("@")).not.toBeInTheDocument();
  });

  it("filters the LIVEs by date, with their totals and top gifters", async () => {
    // A day back reaches Saturday's LIVE, not Friday's, over by 10:28 PM
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 31, 23));
    const since = new Date(2026, 9, 30, 23).getTime();
    const { user } = renderWithProviders(<CoinStats />);
    await lives([saturday, friday]);

    await dates(user, "Last 24 hours");

    expect(options()).toEqual([
      "Last 24 hours, 600 coins",
      expect.stringMatching(/^Saturday/),
    ]);
    expect(selected()).toMatch(/^Last 24 hours/);
    expect(heading()).toHaveTextContent("Last 24 hours");
    expect(stat("Coins")).toHaveTextContent("600");
    // Clearing takes every LIVE, so only All time offers it
    expect(
      screen.queryByRole("button", { name: "Clear history" }),
    ).not.toBeInTheDocument();
    expect(sent(APP_EVENTS.GET_GIFTERS)).toEqual([{ from: since }]);

    // A late reply for other dates is dropped
    await send(APP_EVENTS_RESPONSE.GIFTERS, {
      success: true,
      from: since - 1,
      data: [{ ...gifter("Old", 1), rank: 1 }],
    });
    expect(
      screen.queryByRole("list", { name: "Top gifters" }),
    ).not.toBeInTheDocument();
    await send(APP_EVENTS_RESPONSE.GIFTERS, {
      success: true,
      from: since,
      data: [{ ...gifter("Ana", 5200, 53), rank: 1 }],
    });
    expect(gifterRows("Top gifters")).toEqual([expect.stringContaining("Ana")]);
  });

  it("counts only the gifts in the dates of a LIVE they cut, as main adds them up", async () => {
    // A day back cuts Friday's LIVE, on until 10:28 PM
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 31, 21));
    const since = new Date(2026, 9, 30, 21).getTime();
    const { user } = renderWithProviders(<CoinStats />);
    await lives([saturday, friday]);

    await dates(user, "Last 24 hours");

    expect(options()).toEqual([
      "Last 24 hours, 600 coins",
      expect.stringMatching(/^Saturday/),
      expect.stringMatching(/^Friday/),
    ]);
    expect(screen.getByText("2 LIVEs")).toBeInTheDocument();
    // Saturday's 30 minutes, and Friday's from 9:00 to 10:28:05 PM
    expect(screen.getByText("01:58:05 in total")).toBeInTheDocument();
    // Saturday's alone until main adds Friday's gifts from 9:00 PM
    expect(stat("Coins")).toHaveTextContent("600");
    await send(APP_EVENTS_RESPONSE.GIFTERS, {
      success: true,
      from: since,
      totals: { coins: 900, gifts: 70, platforms: {} },
    });

    expect(stat("Coins")).toHaveTextContent("900");
    expect(stat("Gifts")).toHaveTextContent("70");
    expect(options()[0]).toBe("Last 24 hours, 900 coins");
    // The gifters come after
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });

  it("says when no LIVE or gift matches the dates", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 11, 31));
    const { user } = renderWithProviders(<CoinStats />);
    await lives([saturday, friday]);

    await dates(user, "Last 7 days");

    expect(screen.getByText("No LIVEs on these dates.")).toBeInTheDocument();
    await send(APP_EVENTS_RESPONSE.GIFTERS, {
      success: true,
      from: new Date(2026, 11, 24).getTime(),
      data: [],
    });
    expect(screen.getByText("No gifts on these dates.")).toBeInTheDocument();
  });

  it("takes custom dates in either order, to the minute", async () => {
    // Today, for the calendars, is October 31
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 31, 21));
    const { user } = renderWithProviders(<CoinStats />);
    await lives([saturday, friday]);
    await dates(user, "Custom dates");
    expect(
      screen.getByRole("combobox", { name: "Custom range" }),
    ).toHaveTextContent("Between");

    // October 31 at 6:00 PM, before Saturday's LIVE started at 7:00 PM
    await user.click(screen.getByRole("button", { name: "Date" }));
    await user.click(
      screen.getByRole("button", { name: "Saturday, October 31, 2026" }),
    );
    await user.type(screen.getByRole("textbox", { name: "Hours" }), "6");
    await user.click(screen.getByRole("button", { name: "PM" }));
    await user.keyboard("{Escape}");
    // Not a range until both ends are picked
    expect(heading()).toHaveTextContent("All time");

    // October 30, the whole day
    await user.click(screen.getByRole("button", { name: "End date" }));
    await user.click(
      screen.getByRole("button", { name: "Friday, October 30, 2026" }),
    );
    await user.keyboard("{Escape}");

    expect(heading()).toHaveTextContent(
      /^Oct 30, 2026 to Oct 31, 2026, 6:00\sPM$/,
    );
    expect(options()).toEqual([
      expect.stringMatching(/^Oct 30, 2026 to/),
      expect.stringMatching(/^Friday/),
    ]);
    expect(sent(APP_EVENTS.GET_GIFTERS)).toEqual([
      {
        from: new Date(2026, 9, 30).getTime(),
        to: new Date(2026, 9, 31, 18, 1).getTime(),
      },
    ]);
  });

  it("goes back to All time from a preset", async () => {
    const { user } = renderWithProviders(<CoinStats />);
    await lives([saturday, friday]);

    await dates(user, "Last 12 months");
    await dates(user, "All time");

    expect(heading()).toHaveTextContent("All time");
    expect(
      screen.getByRole("button", { name: "Clear history" }),
    ).toBeInTheDocument();
  });

  it("moves the selection with the arrow keys, Home and End", async () => {
    const { user } = renderWithProviders(<CoinStats />);
    await lives([saturday, friday]);

    // After the back button, the delete button, the gifter search and the
    // date filter, one tab stop: the selected LIVE
    await user.tab();
    await user.tab();
    await user.tab();
    expect(screen.getByRole("button", { name: "Search" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("combobox", { name: "Dates" })).toHaveFocus();
    await user.tab();
    expect(option(/^Saturday/)).toHaveFocus();
    await user.tab();
    expect(document.body).toHaveFocus();
    await user.tab({ shift: true });

    await user.keyboard("{ArrowDown}");
    expect(selected()).toMatch(/^Friday/);
    expect(option(/^Friday/)).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(selected()).toMatch(/^Friday/);

    await user.keyboard("{Home}");
    expect(selected()).toMatch(/^All time/);
    expect(heading()).toHaveTextContent("All time");

    await user.keyboard("{End}");
    expect(selected()).toMatch(/^Friday/);

    await user.keyboard("{ArrowUp}");
    expect(selected()).toMatch(/^Saturday/);
    expect(option(/^Saturday/)).toHaveFocus();
  });

  it("lists the LIVE's gifters, and ignores a late reply for another LIVE", async () => {
    const { user } = renderWithProviders(<CoinStats />);
    await lives([saturday, friday]);
    await user.click(option(/^Friday/));

    await record(saturday, [gifter("Yui", 600, 40)]);
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();

    await record(friday, [gifter("Ana", 5200, 52), gifter("Kai", 1, 1)]);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(gifterRows("Gifters")).toEqual([
      "1AAna@ana5,200 coins52 gifts",
      "2KKai@kai1 coin1 gift",
    ]);
  });

  it("says when a LIVE's gifters couldn't load", async () => {
    renderWithProviders(<CoinStats />);
    await lives([saturday]);

    await send(APP_EVENTS_RESPONSE.LIVE, {
      success: false,
      startedAt: SATURDAY,
      error: { code: FEEDBACK_CODES.LIVE_LOAD_FAILED, message: "No file." },
    });

    expect(
      screen.getByText("Couldn't load this LIVE's gifters."),
    ).toBeInTheDocument();
  });

  it("searches every gifter, keeping their places", async () => {
    const { user } = renderWithProviders(<CoinStats />);
    await lives([saturday], [gifter("Ana", 5200), gifter("Kai", 10)]);
    await user.click(option(/^All time/));

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(screen.getByPlaceholderText("Name or @handle"), "ka");

    // Once typing pauses, so only the last query goes
    await waitFor(() =>
      expect(sent(APP_EVENTS.GET_GIFTERS)).toEqual([{ query: "ka" }]),
    );
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    // A late reply for an earlier search is dropped
    await send(APP_EVENTS_RESPONSE.GIFTERS, {
      success: true,
      query: "k",
      data: [],
    });
    await send(APP_EVENTS_RESPONSE.GIFTERS, {
      success: true,
      query: "ka",
      data: [{ ...gifter("Kai", 10), rank: 2 }],
    });
    expect(gifterRows("Top gifters")).toEqual(["2KKai@kai10 coins1 gift"]);

    await send(APP_EVENTS_RESPONSE.GIFTERS, {
      success: true,
      query: "ka",
      data: [],
    });
    expect(screen.getByText("No gifters match “ka”.")).toBeInTheDocument();

    // Closing it clears the search
    await user.click(screen.getByRole("button", { name: "Close search" }));
    expect(gifterRows("Top gifters")).toEqual([
      expect.stringMatching(/^1AAna/),
      expect.stringMatching(/^2KKai/),
    ]);
  });

  it("searches all of the selected LIVE's gifters", async () => {
    const { user } = renderWithProviders(<CoinStats />);
    await lives([saturday, friday]);
    await user.click(option(/^Friday/));

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(screen.getByPlaceholderText("Name or @handle"), "@ana");

    await waitFor(() =>
      expect(sent(APP_EVENTS.GET_GIFTERS)).toEqual([
        { from: FRIDAY, to: friday.endedAt, query: "@ana" },
      ]),
    );
  });

  it("sums every LIVE in All time, with the top gifters", async () => {
    const { user } = renderWithProviders(<CoinStats />);
    await lives([saturday, friday], [gifter("Ana", 5200, 52)]);

    await user.click(option(/^All time/));

    expect(heading()).toHaveTextContent("All time");
    expect(screen.getByText("2 LIVEs")).toBeInTheDocument();
    expect(screen.getByText("02:44:05 in total")).toBeInTheDocument();
    expect(stat("Coins")).toHaveAttribute("title", "13,000");
    expect(stat("Gifts")).toHaveAttribute("title", "1,243");
    expect(gifterRows("Top gifters")).toEqual(["1AAna@ana5,200 coins52 gifts"]);
    // All time comes with LIVES, nothing more to ask for
    expect(sent(APP_EVENTS.GET_LIVE)).toEqual([{ startedAt: SATURDAY }]);
  });

  it("deletes a LIVE through its modal, then selects the next one", async () => {
    const { user } = renderWithProviders(<CoinStats />);
    await lives([saturday, friday]);

    await user.click(screen.getByRole("button", { name: "Delete LIVE" }));
    const dialog = screen.getByRole("dialog", { name: "Delete LIVE?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(sent(APP_EVENTS.DELETE_LIVE)).toEqual([{ startedAt: SATURDAY }]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await lives([friday]);
    expect(selected()).toMatch(/^Friday/);
    expect(sent(APP_EVENTS.GET_LIVE).at(-1)).toEqual({ startedAt: FRIDAY });
  });

  it("clears the history through its modal", async () => {
    const { user } = renderWithProviders(<CoinStats />);
    await lives([saturday], [gifter("Ana", 600)]);
    await user.click(option(/^All time/));

    await user.click(screen.getByRole("button", { name: "Clear history" }));
    const dialog = screen.getByRole("dialog", { name: "Clear history?" });
    await user.click(
      within(dialog).getByRole("button", { name: "Clear history" }),
    );

    expect(sent(APP_EVENTS.CLEAR_LIVES)).toEqual([undefined]);

    await lives([]);
    expect(options()).toEqual(["All time, 0 coins"]);
    expect(
      screen.getByRole("button", { name: "Clear history" }),
    ).toBeDisabled();
  });

  it("counts a history of Kick's LIVEs alone in Kicks, with no tabs", async () => {
    renderWithProviders(<CoinStats />);

    await lives([
      liveSummary(SATURDAY, {
        gifts: 3,
        platforms: { kick: { amount: 300, gifts: 3, giftSubs: 2 } },
      }),
    ]);
    await record(saturday, [{ ...kicker("Bea", 300, 3), giftSubs: 2 }]);

    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(options()).toEqual([
      "All time, 300 Kicks",
      expect.stringMatching(/^Saturday.*, 300 Kicks$/),
    ]);
    expect(stat("Kicks")).toHaveTextContent("300");
    expect(stat("Gifts")).toHaveTextContent("3");
    expect(stat("Gifted subs")).toHaveTextContent("2");
    expect(screen.queryByText("Coins")).not.toBeInTheDocument();
    expect(gifterRows("Gifters")).toEqual([
      "1BBea@bea300 Kicks3 gifts2 gifted subs",
    ]);
  });

  it("gives each platform in the history its tab, in its currency, then All", async () => {
    const { user } = renderWithProviders(<CoinStats />);
    const part = (amount: number, gifts: number, giftSubs: number) => ({
      amount,
      gifts,
      giftSubs,
    });
    // Saturday's was saved before Tokio kept each platform's part: TikTok's
    const both = {
      ...friday,
      gifts: 1205,
      platforms: {
        tiktok: part(12_400, 1203, 0),
        twitch: part(2500, 0, 4),
        youtube: part(57.4, 2, 1),
      },
    };
    const di: Gifter = {
      ...gifter("Di", 2500, 0),
      userId: "twitch:di",
      platform: "twitch",
      giftSubs: 4,
    };
    const yui: Gifter = {
      ...gifter("Yui", 57.4, 2),
      userId: "youtube:yui",
      platform: "youtube",
      giftSubs: 1,
    };
    await lives([saturday, both], [gifter("Ana", 5200), di, yui]);
    await record(saturday, [gifter("Kai", 600, 40)]);

    const tabs = screen.getByRole("tablist", { name: "Platform" });
    const tab = (name: string) => within(tabs).getByRole("tab", { name });
    expect(
      within(tabs)
        .getAllByRole("tab")
        .map((t) => t.textContent),
    ).toEqual(["TikTok", "Twitch", "YouTube", "All"]);
    expect(tab("TikTok")).toHaveAttribute("aria-selected", "true");
    expect(options()[0]).toBe("All time, 13,000 coins");

    // Only the LIVEs on Twitch, in Bits. Saturday's wasn't, so its totals.
    await user.click(tab("Twitch"));
    // On a platform's tab, its money with no word after it
    expect(option(/^All time/)).toHaveTextContent(/^All time2.5K$/);
    expect(options()).toEqual([
      "All time, 2,500 Bits",
      expect.stringMatching(/^Friday.*, 2,500 Bits$/),
    ]);
    expect(selected()).toMatch(/^All time/);
    expect(screen.getByText("1 LIVE")).toBeInTheDocument();
    expect(stat("Bits")).toHaveAttribute("title", "2,500");
    expect(stat("Gifted subs")).toHaveTextContent("4");
    // Twitch has no gifts
    expect(screen.queryByText("Gifts")).not.toBeInTheDocument();
    expect(gifterRows("Top gifters")).toEqual([
      "1DDi@di2,500 Bits4 gifted subs",
    ]);

    // A LIVE's gifters on the tab's platform alone
    await user.click(option(/^Friday/));
    await record(both, [gifter("Ana", 12_400, 1203), di, yui]);
    expect(gifterRows("Gifters")).toEqual([expect.stringMatching(/^1DDi/)]);

    await user.click(tab("YouTube"));
    expect(selected()).toMatch(/^Friday/);
    expect(stat("Super Chats")).toHaveTextContent("$57.40");
    expect(stat("Gifts")).toHaveTextContent("2");
    expect(stat("Gifted subs")).toHaveTextContent("1");
    expect(gifterRows("Gifters")).toEqual([
      "1YYui@yui$57.402 gifts1 gifted sub",
    ]);

    // Every currency on its own, the LIVEs by their gifts, and no ranking
    await user.click(tab("All"));
    expect(options()).toEqual([
      "All time, 1,245 gifts",
      expect.stringMatching(/^Saturday.*, 40 gifts$/),
      expect.stringMatching(/^Friday.*, 1,205 gifts$/),
    ]);
    expect(bar(/^Friday/)).toBe("100%");
    // The totals row says its number is gifts, not money
    expect(option(/^All time/)).toHaveTextContent("All time1.2K gifts");
    expect(stat("Coins")).toHaveAttribute("title", "12,400");
    expect(stat("Bits")).toHaveAttribute("title", "2,500");
    expect(stat("Super Chats")).toHaveTextContent("$57.40");
    expect(stat("Gifts")).toHaveAttribute("title", "1,205");
    expect(stat("Gifted subs")).toHaveTextContent("5");
    expect(
      screen.getByText("Pick a platform to see who sent the most."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Search" }),
    ).not.toBeInTheDocument();

    // Saturday was TikTok's alone
    await user.click(option(/^Saturday/));
    expect(stat("Coins")).toHaveTextContent("600");
    expect(screen.queryByText("Bits")).not.toBeInTheDocument();
  });

  it("takes each platform's totals for the dates from main", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 31, 21));
    const since = new Date(2026, 9, 30, 21).getTime();
    const { user } = renderWithProviders(<CoinStats />);
    const kick = { amount: 80, gifts: 4, giftSubs: 1 };
    await lives([
      { ...saturday, platforms: { kick } },
      { ...friday, platforms: { kick } },
    ]);

    await dates(user, "Last 24 hours");
    await send(APP_EVENTS_RESPONSE.GIFTERS, {
      success: true,
      from: since,
      totals: {
        coins: 0,
        gifts: 9,
        platforms: { kick: { amount: 120, gifts: 9, giftSubs: 3 } },
      },
    });

    expect(options()[0]).toBe("Last 24 hours, 120 Kicks");
    expect(stat("Kicks")).toHaveTextContent("120");
    expect(stat("Gifted subs")).toHaveTextContent("3");
  });

  it("says what fills an empty history", async () => {
    renderWithProviders(<CoinStats />);

    await lives([]);

    expect(selected()).toMatch(/^All time/);
    expect(
      screen.getByText(
        "No LIVEs yet. Connect on Home, and each LIVE shows up here when it ends.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "No gifts yet. Viewers who send gifts show up here, the biggest gifters first.",
      ),
    ).toBeInTheDocument();
    expect(sent(APP_EVENTS.GET_LIVE)).toEqual([]);
  });

  it("says when a LIVE had no gifts", async () => {
    renderWithProviders(<CoinStats />);
    await lives([saturday]);

    await record(saturday, []);

    expect(screen.getByText(/^No gifts yet\./)).toBeInTheDocument();
  });

  it("asks again after a profile switch, and opens on its newest LIVE", async () => {
    const { user } = renderWithProviders(<CoinStats />);
    await lives([saturday, friday]);
    await user.click(option(/^All time/));

    await send(APP_EVENTS_RESPONSE.GET_PROFILE, profileReply());
    expect(sent(APP_EVENTS.GET_LIVES)).toEqual([undefined, undefined]);

    await lives([friday]);
    expect(selected()).toMatch(/^Friday/);
  });

  it("ignores a resync of the same profile", async () => {
    const { user } = renderWithProviders(<CoinStats />);
    await send(APP_EVENTS_RESPONSE.GET_PROFILE, profileReply());
    await lives([saturday, friday]);
    await user.click(option(/^All time/));

    await send(APP_EVENTS_RESPONSE.GET_PROFILE, profileReply());

    expect(sent(APP_EVENTS.GET_LIVES)).toEqual([undefined, undefined]);
    expect(selected()).toMatch(/^All time/);
  });

  it("drops the last profile's totals and gifters after a switch", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 31, 21));
    const since = new Date(2026, 9, 30, 21).getTime();
    const { user } = renderWithProviders(<CoinStats />);
    await lives([saturday, friday]);
    await dates(user, "Last 24 hours");
    await send(APP_EVENTS_RESPONSE.GIFTERS, {
      success: true,
      from: since,
      totals: { coins: 900, gifts: 70, platforms: {} },
      data: [{ ...gifter("Ana", 300, 30), rank: 1 }],
    });
    expect(stat("Coins")).toHaveTextContent("900");

    await send(APP_EVENTS_RESPONSE.GET_PROFILE, profileReply());
    await lives([saturday]);
    await user.click(option(/^Last 24 hours/));

    expect(stat("Coins")).toHaveTextContent("600");
    expect(screen.queryByText("Ana")).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });

  it("keeps the selection when a LIVE that ended joins the list", async () => {
    const { user } = renderWithProviders(<CoinStats />);
    await lives([friday]);
    await user.click(option(/^All time/));

    await lives([saturday, friday]);

    expect(selected()).toMatch(/^All time/);
  });
});
