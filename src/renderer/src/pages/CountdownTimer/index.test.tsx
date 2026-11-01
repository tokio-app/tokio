import { APP_EVENTS, APP_EVENTS_RESPONSE, TimerData } from "@/common/types";
import { getOverlayURL, TIMER_PATH } from "@/common/util";
import { failure, settingsReply, timerReply } from "@test/fixtures";
import { send, sent, sentEvents } from "@test/ipc";
import { section } from "@test/queries";
import { renderApp, renderWithProviders } from "@test/render";
import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CountdownTimer } from ".";

const timer = (recipe?: (data: TimerData) => void) =>
  send(APP_EVENTS_RESPONSE.TIMER, timerReply(recipe));

const running = (remaining: number) =>
  timer((t) => {
    t.state = { status: "running", remaining };
  });

const titleInput = () =>
  within(
    section("Timer look").getByRole("group", { name: /optional/ }),
  ).getByRole("textbox");
const button = (name: string) => screen.getByRole("button", { name });
const clock = () => screen.getByRole("timer");
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const fakeTimers = () => ({
  user: { advanceTimers: (ms: number) => vi.advanceTimersByTime(ms) },
});

describe("CountdownTimer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks main for the settings and the timer", () => {
    renderWithProviders(<CountdownTimer />);

    expect(sentEvents()).toEqual([
      APP_EVENTS.GET_SETTINGS,
      APP_EVENTS.GET_TIMER,
    ]);
  });

  it("shows its header and a loader until the timer comes", async () => {
    renderWithProviders(<CountdownTimer />);

    const header = section("Countdown timer");
    expect(header.getByText("A countdown viewers add time to.")).toBeVisible();
    expect(
      header.getByRole("button", { name: "Back to Tools" }),
    ).toBeInTheDocument();
    expect(header.getByRole("status", { name: "Loading" })).toBeInTheDocument();

    await timer();

    expect(screen.queryByRole("status", { name: "Loading" })).toBeNull();
    expect(
      section("Countdown timer").getByRole("button", { name: "Back to Tools" }),
    ).toBeInTheDocument();
  });

  it("warns while the overlay server is off", async () => {
    renderWithProviders(<CountdownTimer />);
    const notice =
      "The overlay server is off. Enable it in Settings to show the timer on stream.";
    await timer();
    expect(screen.queryByText(notice)).not.toBeInTheDocument();

    await send(
      APP_EVENTS_RESPONSE.GET_SETTINGS,
      settingsReply((s) => {
        s.settings.server.enabled = false;
      }),
    );
    expect(screen.getByText(notice)).toBeInTheDocument();
    // Once, above the sections
    expect(section("Countdown timer").queryByText(notice)).toBeNull();

    await send(
      APP_EVENTS_RESPONSE.GET_SETTINGS,
      settingsReply((s) => {
        s.settings.server.enabled = true;
      }),
    );
    expect(screen.queryByText(notice)).not.toBeInTheDocument();
  });

  it("goes back to Tools", async () => {
    const { user, router } = await renderApp("/tools/timer");
    await timer();

    await user.click(screen.getByRole("button", { name: "Back to Tools" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/tools"));
    expect(screen.getByRole("heading", { name: "Tools" })).toBeInTheDocument();
  });

  it("shows once main sends it, and keeps it when a request fails", async () => {
    renderWithProviders(<CountdownTimer />);
    expect(screen.queryByRole("timer")).toBeNull();

    await timer();
    expect(clock()).toHaveTextContent("01:00:00");
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByTitle("Copy the timer's URL")).toHaveTextContent(
      getOverlayURL(TIMER_PATH),
    );

    await send(APP_EVENTS_RESPONSE.TIMER, failure());
    expect(clock()).toHaveTextContent("01:00:00");
  });

  it("enables the controls that apply to each status", async () => {
    renderWithProviders(<CountdownTimer />);
    const enabled = () =>
      ["Start", "Pause", "Stop", "Reset", "Remove", "Add"].filter(
        (name) => !button(name).matches(":disabled"),
      );

    await timer();
    expect(enabled()).toEqual(["Start"]);

    await running(60_000);
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(enabled()).toEqual(["Pause", "Stop", "Reset", "Remove", "Add"]);

    await timer((t) => {
      t.state = { status: "paused", remaining: 60_000 };
    });
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(enabled()).toEqual(["Start", "Stop", "Reset", "Remove", "Add"]);

    await timer((t) => {
      t.state = { status: "stopped", remaining: 60_000 };
    });
    expect(screen.getByText("Stopped")).toBeInTheDocument();
    expect(enabled()).toEqual(["Start", "Reset", "Remove", "Add"]);

    // Start can't carry on from 0
    await timer((t) => {
      t.state = { status: "stopped", remaining: 0 };
    });
    expect(screen.getByText("Time's up")).toBeInTheDocument();
    expect(enabled()).toEqual(["Reset", "Remove", "Add"]);
  });

  it("sends the controls", async () => {
    const { user } = renderWithProviders(<CountdownTimer />);
    await timer();
    await user.click(button("Start"));

    await running(60_000);
    await user.click(button("Pause"));
    await user.click(button("Stop"));

    expect(sent(APP_EVENTS.TIMER_CONTROL)).toEqual([
      { action: "start" },
      { action: "pause" },
      { action: "stop" },
    ]);
  });

  it("saves a starting time being typed before Start", async () => {
    const { user } = renderWithProviders(<CountdownTimer />);
    await timer();
    const start = within(
      screen.getByRole("group", { name: /Starting time/ }),
    ).getByRole("spinbutton");

    await user.clear(start);
    await user.type(start, "90");
    await user.click(button("Start"));

    expect(
      sentEvents().filter(
        (e) =>
          e === APP_EVENTS.SET_TIMER_SETTINGS || e === APP_EVENTS.TIMER_CONTROL,
      ),
    ).toEqual([APP_EVENTS.SET_TIMER_SETTINGS, APP_EVENTS.TIMER_CONTROL]);
    expect(sent(APP_EVENTS.SET_TIMER_SETTINGS)[0].settings.start).toBe(90);
  });

  it("adds and removes the minutes typed", async () => {
    const { user } = renderWithProviders(<CountdownTimer />);
    await running(60_000);
    const minutes = screen.getByRole("spinbutton", {
      name: "Minutes to add or remove",
    });
    expect(minutes).toHaveValue(5);

    await user.click(button("Add"));
    await user.clear(minutes);
    await user.type(minutes, "1.5");
    await user.click(button("Remove"));

    expect(sent(APP_EVENTS.ADJUST_TIMER)).toEqual([
      { seconds: 300 },
      { seconds: -90 },
    ]);
  });

  it("asks before resetting", async () => {
    const { user } = renderWithProviders(<CountdownTimer />);
    await running(60_000);

    await user.click(button("Reset"));
    const dialog = screen.getByRole("dialog", { name: "Reset the timer?" });
    expect(dialog).toHaveAccessibleDescription(
      "It goes back to the starting time, 1:00:00. The time added so far is lost.",
    );
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(sent(APP_EVENTS.TIMER_CONTROL)).toEqual([]);

    await user.click(button("Reset"));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Reset" }),
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(sent(APP_EVENTS.TIMER_CONTROL)).toEqual([{ action: "reset" }]);
  });

  it("saves the settings while main keeps pushing the clock", async () => {
    vi.useFakeTimers();
    const { user } = renderWithProviders(<CountdownTimer />, fakeTimers());
    await running(60_000);

    await user.type(titleInput(), "Sub");
    await user.clear(screen.getByLabelText("Follows"));
    await user.type(screen.getByLabelText("Follows"), "31");
    // A push every 100ms doesn't hold the save back
    for (let i = 0; i < 4; i++) {
      await running(60_000 - i * 100);
      await wait(100);
    }

    const saves = sent(APP_EVENTS.SET_TIMER_SETTINGS);
    expect(saves).toHaveLength(1);
    expect(saves[0].settings.look.title).toBe("Sub");
    expect(saves[0].settings.seconds.follow).toBe(31);
  });

  it("puts Timer look right after the countdown, where the preview shows", async () => {
    renderWithProviders(<CountdownTimer />);
    await timer();

    expect(
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
    ).toEqual(["Countdown timer", "Timer look", "Time added"]);
  });

  it("gives chat a keyword and a cooldown, and no boxes, joins or envelopes", async () => {
    vi.useFakeTimers();
    const { user } = renderWithProviders(<CountdownTimer />, fakeTimers());
    await timer();
    const added = section("Time added");
    for (const gone of [
      "Super Fan boxes",
      "Envelopes",
      "Viewers joining",
      "Super Fans joining",
    ]) {
      expect(added.queryByText(gone)).toBeNull();
    }

    const keyword = added.getByRole("textbox", { name: "Keyword or phrase" });
    expect(keyword).toHaveAttribute("placeholder", "Any message");
    await user.type(keyword, "!time");
    const cooldown = added.getByRole("spinbutton", {
      name: "Seconds between a viewer's messages",
    });
    await user.clear(cooldown);
    await user.type(cooldown, "10");
    await wait(300);

    expect(sent(APP_EVENTS.SET_TIMER_SETTINGS).at(-1)!.settings.chat).toEqual({
      keyword: "!time",
      cooldown: 10,
    });
  });

  it("shows the triggers in turn, with the names given them", async () => {
    vi.useFakeTimers();
    const { user } = renderWithProviders(<CountdownTimer />, fakeTimers());
    await timer((t) => {
      // Follows and shares add time
      t.settings.seconds = {
        ...t.settings.seconds,
        coin: 0,
        likes: 0,
        superfan: 0,
      };
    });
    const look = section("Timer look");
    const names = () =>
      within(look.getByRole("list", { name: "Names on stream" }));
    expect(look.queryByRole("list", { name: "Names on stream" })).toBeNull();
    expect(screen.queryByText("+30s")).toBeNull();

    await user.click(
      look.getByRole("checkbox", { name: "Show the triggers, one at a time" }),
    );
    expect(
      names()
        .getAllByRole("textbox")
        .map((input) => input.getAttribute("aria-label")),
    ).toEqual(["Follows on stream", "Shares on stream"]);
    expect(screen.getByText("+30s").parentElement).toHaveTextContent(
      "Follow+30s",
    );

    const follow = names().getByRole("textbox", { name: "Follows on stream" });
    await user.clear(follow);
    await user.type(follow, "Seguir");
    expect(screen.getByText("+30s").parentElement).toHaveTextContent(
      "Seguir+30s",
    );
    await wait(3000);
    expect(screen.getByText("+10s").parentElement).toHaveTextContent(
      "Share+10s",
    );

    const saved = sent(APP_EVENTS.SET_TIMER_SETTINGS).at(-1)!.settings.look;
    expect(saved).toMatchObject({ show_triggers: true });
    expect(saved.names.follow).toBe("Seguir");
  });

  it("lists no names when the multiplier makes every trigger add nothing", async () => {
    const { user } = renderWithProviders(<CountdownTimer />);
    await timer((t) => {
      t.settings.multiplier = 0;
    });
    const look = section("Timer look");

    await user.click(
      look.getByRole("checkbox", { name: "Show the triggers, one at a time" }),
    );

    expect(look.getByText(/No trigger adds time yet/)).toBeInTheDocument();
    expect(look.queryByRole("list", { name: "Names on stream" })).toBeNull();
  });

  it("adds a trigger's seconds and the likes per cycle", async () => {
    vi.useFakeTimers();
    const { user } = renderWithProviders(<CountdownTimer />, fakeTimers());
    await timer();

    await user.clear(screen.getByLabelText("Likes"));
    await user.type(screen.getByLabelText("Likes"), "5");
    await user.clear(screen.getByLabelText("Likes per cycle"));
    await user.type(screen.getByLabelText("Likes per cycle"), "50");
    await wait(300);

    const saves = sent(APP_EVENTS.SET_TIMER_SETTINGS);
    expect(saves.at(-1)!.settings.seconds).toMatchObject({
      likes: 5,
      likes_every: 50,
    });
  });

  it("shows the preview with the look being edited", async () => {
    vi.stubGlobal("queryLocalFonts", async () => [{ family: "Bebas Neue" }]);
    const { user } = renderWithProviders(<CountdownTimer />);
    await timer((t) => {
      t.settings.multiplier = 2;
    });
    const look = section("Timer look");
    expect(screen.getByText("×2")).toBeInTheDocument();
    await user.type(titleInput(), "Subathon");
    await user.click(
      within(look.getByRole("group", { name: "Clock font" })).getByRole(
        "button",
      ),
    );
    await user.click(await screen.findByRole("button", { name: "Bebas Neue" }));
    await user.click(
      look.getByRole("checkbox", { name: "Show the multiplier" }),
    );

    const title = screen.getByText("Subathon");
    expect(title).toHaveStyle({ color: "#f1f5f9" });
    expect(clock().style.fontFamily).toBe(
      '"Bebas Neue", "Archivo Variable", sans-serif',
    );
    expect(screen.queryByText("×2")).toBeNull();
  });

  it("rounds the multiplier as the overlay does", async () => {
    renderWithProviders(<CountdownTimer />);

    await timer((t) => {
      t.settings.multiplier = 1.3333;
    });

    expect(screen.getByText("×1.33")).toBeInTheDocument();
  });

  it("starts from the starting time being typed while idle", async () => {
    const { user } = renderWithProviders(<CountdownTimer />);
    await timer();
    const start = within(
      screen.getByRole("group", { name: /Starting time/ }),
    ).getByRole("spinbutton");

    await user.clear(start);
    await user.type(start, "90");

    expect(clock()).toHaveTextContent("01:30:00");
  });

  it("takes the warning color in the last minutes while running", async () => {
    renderWithProviders(<CountdownTimer />);
    const warn = (t: TimerData) => {
      t.settings.look.warning_color = "#ffaa00";
      t.settings.look.warn_at = 2;
    };

    await timer((t) => {
      warn(t);
      t.state = { status: "running", remaining: 3 * 60_000 };
    });
    expect(clock()).toHaveStyle({ color: "#f1f5f9" });

    await timer((t) => {
      warn(t);
      t.state = { status: "running", remaining: 2 * 60_000 };
    });
    expect(clock()).toHaveStyle({ color: "#ffaa00" });

    await timer((t) => {
      warn(t);
      t.state = { status: "paused", remaining: 60_000 };
    });
    expect(clock()).toHaveStyle({ color: "#f1f5f9" });
  });

  it("ticks only while running, rounding up to the second", async () => {
    vi.useFakeTimers();
    renderWithProviders(<CountdownTimer />);

    await running(10_000);
    expect(clock()).toHaveTextContent("00:00:10");
    await wait(250);
    expect(clock()).toHaveTextContent("00:00:10");
    await wait(750);
    expect(clock()).toHaveTextContent("00:00:09");

    await timer((t) => {
      t.state = { status: "paused", remaining: 8_500 };
    });
    await wait(5000);
    expect(clock()).toHaveTextContent("00:00:09");
  });

  it("sums the time added while it shows under the clock", async () => {
    vi.useFakeTimers();
    renderWithProviders(<CountdownTimer />);
    await timer((t) => {
      t.settings.multiplier = 2;
      t.settings.look.accent_color = "#00ff00";
    });
    const push = (added: number) =>
      timer((t) => {
        t.settings.multiplier = 2;
        t.settings.look.accent_color = "#00ff00";
        t.state = { status: "running", remaining: 60_000 };
        t.added = added;
      });

    await push(60_000);
    await wait(1000);
    await push(30_000);
    expect(screen.getByText("+1:30")).toHaveStyle({ color: "#00ff00" });
    expect(screen.queryByText("×2")).toBeNull();

    // Shown for 1.5s after the last change, then the multiplier is back
    await wait(1400);
    expect(screen.getByText("+1:30")).toBeInTheDocument();
    await wait(100);
    expect(screen.queryByText("+1:30")).toBeNull();
    expect(screen.getByText("×2")).toBeInTheDocument();

    await push(-300_000);
    expect(screen.getByText("−5:00")).toHaveStyle({ color: "#f1f5f9" });
  });
});
