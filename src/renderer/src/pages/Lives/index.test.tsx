import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  FEEDBACK_CODES,
  Gifter,
  LiveSummary,
} from "@/common/types";
import { gifter, liveSummary, profileReply } from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { renderWithProviders } from "@test/render";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Lives } from ".";

// Local times, so the dates read the same in any time zone
const FRIDAY = new Date(2026, 9, 30, 20, 14).getTime();
const SATURDAY = new Date(2026, 9, 31, 19, 0).getTime();

const friday = liveSummary(FRIDAY, {
  username: "kai_live",
  endedAt: FRIDAY + (2 * 3600 + 14 * 60 + 5) * 1000,
  coins: 12_400,
  gifts: 1203,
  followers: 87,
  shares: 24,
  likes: 18_200,
  peakViewers: 312,
  views: 5100,
});
const saturday = liveSummary(SATURDAY, {
  username: "kai_live",
  endedAt: SATURDAY + 30 * 60 * 1000,
  coins: 600,
  gifts: 40,
  followers: 3,
  shares: 1,
  likes: 900,
  peakViewers: 40,
  views: 300,
});

const lives = (list: LiveSummary[], gifters: Gifter[] = []) =>
  send(APP_EVENTS_RESPONSE.LIVES, { data: { lives: list, gifters } });

const record = (live: LiveSummary, gifters: Gifter[]) =>
  send(APP_EVENTS_RESPONSE.LIVE, {
    success: true,
    startedAt: live.startedAt,
    data: { ...live, gifters },
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
const heading = () => screen.getAllByRole("heading", { level: 2 })[0];
// The value shown above a stat's label
const stat = (label: string) => screen.getByText(label).previousElementSibling;
const gifterRows = (name: string) =>
  within(screen.getByRole("list", { name }))
    .getAllByRole("listitem")
    .map((row) => row.textContent);

describe("Lives", () => {
  it("asks main for the LIVEs", () => {
    renderWithProviders(<Lives />);

    expect(sent(APP_EVENTS.GET_LIVES)).toEqual([undefined]);
  });

  it("lists All time first, then the LIVEs newest first", async () => {
    renderWithProviders(<Lives />);

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
    renderWithProviders(<Lives />);

    await lives([saturday, friday]);

    expect(selected()).toMatch(/^Saturday/);
    expect(heading()).toHaveTextContent("Saturday, October 31, 2026");
    expect(sent(APP_EVENTS.GET_LIVE)).toEqual([{ startedAt: SATURDAY }]);
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });

  it("starts a Spanish date's title with a capital", async () => {
    history.replaceState(null, "", "?lang=es-419");
    try {
      renderWithProviders(<Lives />);
      await lives([saturday]);

      expect(heading()).toHaveTextContent("Sábado, 31 de octubre de 2026");
    } finally {
      history.replaceState(null, "", "/");
    }
  });

  it("shows the selected LIVE: when, how long, whose and what it counted", async () => {
    const { user } = renderWithProviders(<Lives />);
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
    expect(stat("New followers")).toHaveTextContent("87");
    expect(stat("Shares")).toHaveTextContent("24");
    expect(stat("Likes")).toHaveTextContent("18.2K");
    expect(stat("Peak viewers")).toHaveTextContent("312");
    expect(stat("Views")).toHaveTextContent("5.1K");
    expect(sent(APP_EVENTS.GET_LIVE)).toEqual([
      { startedAt: SATURDAY },
      { startedAt: FRIDAY },
    ]);
  });

  it("leaves out the @username a LIVE doesn't have", async () => {
    renderWithProviders(<Lives />);
    await lives([liveSummary(SATURDAY, { username: "" })]);

    expect(heading()).toHaveTextContent("Saturday, October 31, 2026");
    expect(screen.queryByText("@")).not.toBeInTheDocument();
  });

  it("moves the selection with the arrow keys, Home and End", async () => {
    const { user } = renderWithProviders(<Lives />);
    await lives([saturday, friday]);

    // After the delete button, one tab stop: the selected LIVE
    await user.tab();
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
    const { user } = renderWithProviders(<Lives />);
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
    renderWithProviders(<Lives />);
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

  it("sums every LIVE in All time, with the best peak and the top gifters", async () => {
    const { user } = renderWithProviders(<Lives />);
    await lives([saturday, friday], [gifter("Ana", 5200, 52)]);

    await user.click(option(/^All time/));

    expect(heading()).toHaveTextContent("All time");
    expect(screen.getByText("2 LIVEs")).toBeInTheDocument();
    expect(screen.getByText("02:44:05 in total")).toBeInTheDocument();
    expect(stat("Coins")).toHaveAttribute("title", "13,000");
    expect(stat("Gifts")).toHaveAttribute("title", "1,243");
    expect(stat("New followers")).toHaveTextContent("90");
    expect(stat("Shares")).toHaveTextContent("25");
    expect(stat("Likes")).toHaveAttribute("title", "19,100");
    expect(stat("Peak viewers")).toHaveTextContent("312");
    expect(stat("Views")).toHaveAttribute("title", "5,400");
    expect(gifterRows("Top gifters")).toEqual(["1AAna@ana5,200 coins52 gifts"]);
    // All time comes with LIVES, nothing more to ask for
    expect(sent(APP_EVENTS.GET_LIVE)).toEqual([{ startedAt: SATURDAY }]);
  });

  it("deletes a LIVE through its modal, then selects the next one", async () => {
    const { user } = renderWithProviders(<Lives />);
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
    const { user } = renderWithProviders(<Lives />);
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

  it("says what fills an empty history", async () => {
    renderWithProviders(<Lives />);

    await lives([]);

    expect(selected()).toMatch(/^All time/);
    expect(
      screen.getByText(
        "No LIVEs yet. Connect on Home, and each LIVE shows up here when it ends.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "No gifts yet. Viewers who send gifts show up here, the most coins first.",
      ),
    ).toBeInTheDocument();
    expect(sent(APP_EVENTS.GET_LIVE)).toEqual([]);
  });

  it("says when a LIVE had no gifts", async () => {
    renderWithProviders(<Lives />);
    await lives([saturday]);

    await record(saturday, []);

    expect(screen.getByText(/^No gifts yet\./)).toBeInTheDocument();
  });

  it("asks again after a profile switch, and opens on its newest LIVE", async () => {
    const { user } = renderWithProviders(<Lives />);
    await lives([saturday, friday]);
    await user.click(option(/^All time/));

    await send(APP_EVENTS_RESPONSE.GET_PROFILE, profileReply());
    expect(sent(APP_EVENTS.GET_LIVES)).toEqual([undefined, undefined]);

    await lives([friday]);
    expect(selected()).toMatch(/^Friday/);
  });

  it("keeps the selection when a LIVE that ended joins the list", async () => {
    const { user } = renderWithProviders(<Lives />);
    await lives([friday]);
    await user.click(option(/^All time/));

    await lives([saturday, friday]);

    expect(selected()).toMatch(/^All time/);
  });
});
