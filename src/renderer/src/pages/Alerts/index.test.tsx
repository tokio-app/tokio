import { Alert, Profile } from "@/common/schemas";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  EMOTE_TRIGGER,
  TOKIO_EVENTS,
} from "@/common/types";
import {
  alertSound,
  failure,
  gift,
  instantSound,
  profileReply,
  voice,
} from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { inList } from "@test/queries";
import { renderWithProviders } from "@test/render";
import { act, fireEvent, screen, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Alerts } from ".";

const airhorn = alertSound("Airhorn");
const bell = alertSound("Bell");
const aria = voice("en-US-AriaNeural");

const alert = (id: string, patch: Partial<Alert> = {}): Alert => ({
  id,
  enabled: true,
  trigger: {
    type: TOKIO_EVENTS.FOLLOW,
    gifts: [],
    emotes: [],
    keyword: "",
    user: "",
  },
  sound: airhorn,
  tts: null,
  volume: 80,
  ...patch,
});

const trigger = (type: Alert["trigger"]["type"]): Alert["trigger"] => ({
  ...alert("").trigger,
  type,
});

const speech = (message: string) => ({
  voice: aria,
  message,
  speed: 1,
  pitch: 1,
});

function setup() {
  return renderWithProviders(<Alerts />, {
    user: { advanceTimers: (ms) => vi.advanceTimersByTime(ms) },
  });
}

async function load(items: Alert[], recipe?: (profile: Profile) => void) {
  const app = setup();
  await send(
    APP_EVENTS_RESPONSE.GET_PROFILE,
    profileReply((p) => {
      p.alerts.items = items;
      recipe?.(p);
    }),
  );
  return app;
}

const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const saves = () =>
  sent(APP_EVENTS.UPDATE_ALERTS_SETTINGS).map(({ settings }) => settings);

// An alert's row: the cell with its Remove button sits in it
const rows = () =>
  screen
    .queryAllByRole("button", { name: "Remove" })
    .filter((button) => !button.closest("[role=dialog]"))
    .map((button) => within(button.parentElement!.parentElement!));

const addAlert = () => screen.getByRole("button", { name: "Add alert" });
// Asks main for a file's sound, which it answers with SET_ALERT_SOUND
const browse = () =>
  within(screen.getByRole("dialog")).getByRole("button", {
    name: "Browse file...",
  });
// Starts downloading a MyInstants sound in the open picker
async function download(user: UserEvent) {
  const dialog = within(screen.getByRole("dialog"));
  await user.click(dialog.getByRole("tab", { name: "MyInstants" }));
  await send(APP_EVENTS_RESPONSE.SEARCH_SOUNDS, {
    success: true,
    query: "",
    page: 1,
    data: [instantSound("Bruh")],
    hasNextPage: false,
  });
  await user.click(
    dialog.getByRole("button", { name: "Download and use this sound" }),
  );
}
const empty = "No alerts yet. Use the add button to create one.";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Alerts", () => {
  it("asks main for the profile and the gifts", () => {
    setup();

    expect(sent(APP_EVENTS.GET_PROFILE)).toHaveLength(1);
    expect(sent(APP_EVENTS.GET_GIFTS)).toHaveLength(1);
    expect(sent(APP_EVENTS.GET_CUSTOM_GIFTS)).toHaveLength(1);
  });

  it("lists the profile's alerts", async () => {
    await load([
      alert("alert-1"),
      alert("alert-2", {
        enabled: false,
        trigger: trigger(TOKIO_EVENTS.SHARE),
        sound: null,
        tts: speech("Thanks for sharing"),
        volume: 40,
      }),
    ]);

    const [follow, share] = rows();
    expect(follow.getByText("Follow")).toBeInTheDocument();
    expect(follow.getByRole("button", { name: "Airhorn" })).toBeInTheDocument();
    expect(follow.getByRole("checkbox")).toBeChecked();
    expect(follow.getByRole("slider")).toHaveValue("80");

    expect(share.getByText("Share")).toBeInTheDocument();
    expect(
      share.getByRole("button", { name: "TTS: Thanks for sharing" }),
    ).toBeInTheDocument();
    expect(share.getByRole("checkbox")).not.toBeChecked();
    expect(share.getByRole("slider")).toHaveValue("40");
    expect(screen.queryByText(empty)).not.toBeInTheDocument();
  });

  it("says when there are no alerts", async () => {
    await load([]);

    expect(screen.getByText(empty)).toBeInTheDocument();
    expect(rows()).toHaveLength(0);
  });

  it("adds a follow alert without a sound", async () => {
    const { user } = await load([]);

    await user.click(addAlert());

    const [added] = rows();
    expect(added.getByText("Follow")).toBeInTheDocument();
    expect(
      added.getByRole("button", { name: "Select a sound..." }),
    ).toBeInTheDocument();
    expect(added.getByRole("button", { name: "Play" })).toBeDisabled();

    await wait(300);
    expect(saves()).toEqual([
      {
        simultaneous: false,
        queue_length: 100,
        items: [
          {
            id: expect.any(String),
            enabled: true,
            trigger: trigger(TOKIO_EVENTS.FOLLOW),
            sound: null,
            tts: null,
            volume: 100,
          },
        ],
      },
    ]);
  });

  it("saves 300ms after a change", async () => {
    const { user } = await load([]);

    await user.click(addAlert());
    await wait(299);
    expect(saves()).toEqual([]);

    await wait(1);
    expect(saves()).toHaveLength(1);
  });

  it("saves quick changes together", async () => {
    const { user } = await load([]);

    await user.click(addAlert());
    await wait(200);
    await user.click(addAlert());
    await wait(299);
    expect(saves()).toEqual([]);

    await wait(1);
    expect(saves()).toHaveLength(1);
    expect(saves()[0].items).toHaveLength(2);
  });

  it("sends a change that's still waiting when the page closes", async () => {
    const { user, unmount } = await load([]);
    await user.click(addAlert());

    unmount();

    expect(saves()).toHaveLength(1);
    expect(saves()[0].items).toHaveLength(1);
  });

  it("doesn't send a change twice when the page closes", async () => {
    const { user, unmount } = await load([]);
    await user.click(addAlert());
    await wait(300);

    unmount();

    expect(saves()).toHaveLength(1);
  });

  it("doesn't save the profile it just loaded", async () => {
    const { unmount } = await load([alert("alert-1")]);

    await wait(1000);
    unmount();

    expect(saves()).toEqual([]);
  });

  // Sending it on leaving would write it into the new profile
  it("drops a waiting change when another profile loads", async () => {
    const { user, unmount } = await load([alert("alert-1")]);
    await user.click(addAlert());

    await send(
      APP_EVENTS_RESPONSE.GET_PROFILE,
      profileReply((p) => {
        p.name = "Horror";
      }),
    );
    await wait(300);
    unmount();

    expect(saves()).toEqual([]);
  });

  it("reloads the profile when saving fails", async () => {
    await load([]);

    await send(APP_EVENTS_RESPONSE.UPDATE_ALERTS_SETTINGS, { success: true });
    expect(sent(APP_EVENTS.GET_PROFILE)).toHaveLength(1);

    await send(APP_EVENTS_RESPONSE.UPDATE_ALERTS_SETTINGS, failure());
    expect(sent(APP_EVENTS.GET_PROFILE)).toHaveLength(2);
  });

  it("changes the volume of an alert and of its sounds playing", async () => {
    const { audio } = await load([alert("alert-1")]);
    expect(audio.value.setItemGain).toHaveBeenCalledWith("alert-1", 0.8);

    fireEvent.change(rows()[0].getByRole("slider"), {
      target: { value: "30" },
    });

    expect(audio.value.setItemGain).toHaveBeenLastCalledWith("alert-1", 0.3);
    await wait(300);
    expect(saves()[0].items[0].volume).toBe(30);
  });

  it("turns an alert off and removes another", async () => {
    const { user } = await load([alert("alert-1"), alert("alert-2")]);

    await user.click(rows()[0].getByRole("checkbox"));
    await user.click(rows()[1].getByRole("button", { name: "Remove" }));

    expect(rows()).toHaveLength(1);
    await wait(300);
    expect(saves()[0].items).toEqual([alert("alert-1", { enabled: false })]);
  });

  it("plays alerts simultaneously and limits their queue", async () => {
    const { user } = await load([]);
    const simultaneous = screen.getByRole("checkbox", {
      name: "Play alerts simultaneously",
    });
    const queueLength = screen.getByRole("spinbutton", {
      name: "Max queue length",
    });
    expect(simultaneous).not.toBeChecked();
    expect(queueLength).toHaveValue(100);

    await user.click(simultaneous);
    fireEvent.change(queueLength, { target: { value: "5" } });

    expect(simultaneous).toBeChecked();
    expect(queueLength).toHaveValue(5);
    await wait(300);
    expect(saves()).toEqual([
      { simultaneous: true, queue_length: 5, items: [] },
    ]);
  });

  it("only saves a queue length that's a whole number of at least 1", async () => {
    await load([]);
    const queueLength = screen.getByRole("spinbutton", {
      name: "Max queue length",
    });

    for (const value of ["0", "-3", "2.7", ""]) {
      fireEvent.change(queueLength, { target: { value } });
    }
    await wait(300);
    expect(saves()).toEqual([]);

    // Leaving the field shows the saved length again
    fireEvent.blur(queueLength);
    expect(queueLength).toHaveValue(100);

    fireEvent.change(queueLength, { target: { value: "25" } });
    await wait(300);
    expect(saves().map((s) => s.queue_length)).toEqual([25]);
  });

  it("lets the queue length be cleared and typed again", async () => {
    const { user } = await load([]);
    const queueLength = screen.getByRole("spinbutton", {
      name: "Max queue length",
    });

    await user.clear(queueLength);
    await user.type(queueLength, "5");

    expect(queueLength).toHaveValue(5);
  });

  it("changes the trigger and its filter", async () => {
    const { user, container } = await load([alert("alert-1")]);

    await user.click(rows()[0].getByText("Follow"));
    await user.click(inList(container, "Chat")!);
    await user.type(rows()[0].getByPlaceholderText("Any message"), "hello");

    await wait(300);
    expect(saves()[0].items[0].trigger).toEqual({
      ...trigger(TOKIO_EVENTS.CHAT),
      keyword: "hello",
    });
  });

  it("picks the gifts of a gift alert from main's list", async () => {
    const { user } = await load([
      alert("alert-1", { trigger: trigger(TOKIO_EVENTS.GIFT) }),
    ]);
    await send(APP_EVENTS_RESPONSE.GET_GIFTS, {
      data: [gift(1, "Rose"), gift(5, "Lion")],
    });

    await user.click(rows()[0].getByText("Any gift"));
    const dialog = within(screen.getByRole("dialog"));
    await user.click(dialog.getByTitle("Lion"));
    await user.click(dialog.getByRole("button", { name: "Done" }));

    expect(rows()[0].getByText("Lion")).toBeInTheDocument();
    await wait(300);
    expect(saves()[0].items[0].trigger.gifts).toEqual([5]);
  });

  it("lists an alert's gifts first when its picker opens again", async () => {
    const { user } = await load([
      alert("alert-1", { trigger: trigger(TOKIO_EVENTS.GIFT) }),
    ]);
    await send(APP_EVENTS_RESPONSE.GET_GIFTS, {
      data: [gift(1, "Rose"), gift(5, "Lion"), gift(9, "Galaxy")],
    });
    const dialog = () => within(screen.getByRole("dialog"));
    const listed = () =>
      dialog()
        .getAllByRole("checkbox")
        .map((box) => box.closest("label")!.title);

    await user.click(rows()[0].getByText("Any gift"));
    expect(listed()).toEqual(["Rose", "Lion", "Galaxy"]);
    await user.click(dialog().getByTitle("Galaxy"));
    await user.click(dialog().getByRole("button", { name: "Done" }));

    await user.click(rows()[0].getByText("Galaxy"));

    expect(listed()).toEqual(["Galaxy", "Rose", "Lion"]);
  });

  it("offers the gifts saved from LIVEs with TikTok's, as they arrive", async () => {
    const { user } = await load([
      alert("alert-1", { trigger: trigger(TOKIO_EVENTS.GIFT) }),
    ]);
    await send(APP_EVENTS_RESPONSE.GET_GIFTS, { data: [gift(1, "Rose")] });
    await send(APP_EVENTS_RESPONSE.CUSTOM_GIFTS, {
      data: [gift(9, "Galaxy")],
    });

    await user.click(rows()[0].getByText("Any gift"));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.queryByTitle("Rose")).not.toBeNull();
    expect(dialog.queryByTitle("Galaxy")).not.toBeNull();
    expect(dialog.queryByTitle("Comet")).toBeNull();

    // While the picker is open
    await send(APP_EVENTS_RESPONSE.CUSTOM_GIFTS, {
      data: [gift(9, "Galaxy"), gift(5, "Comet")],
    });
    await user.click(dialog.getByTitle("Comet"));
    await user.click(dialog.getByRole("button", { name: "Done" }));

    expect(rows()[0].getByText("Comet")).toBeInTheDocument();
    await wait(300);
    expect(saves()[0].items[0].trigger.gifts).toEqual([5]);
  });

  it("offers the emotes seen in chat, numbered, as they arrive", async () => {
    const { user, container } = await load(
      [alert("alert-1", { trigger: trigger(EMOTE_TRIGGER) })],
      (p) => {
        p.emotes = [{ id: "e1", image: "e1.png" }];
      },
    );

    await user.click(rows()[0].getByText("Any emote"));
    expect(inList(container, "Emote 1")).not.toBeNull();
    expect(inList(container, "Emote 2")).toBeNull();

    await send(APP_EVENTS_RESPONSE.EMOTES, {
      data: [
        { id: "e1", image: "e1.png" },
        { id: "e2", image: "e2.png" },
      ],
    });
    await user.click(inList(container, "Emote 2")!);

    expect(rows()[0].getByText("Emote 2")).toBeInTheDocument();
    await wait(300);
    expect(saves()[0].items[0].trigger.emotes).toEqual(["e2"]);
  });

  it("opens the sound picker for the alert, and a library sound replaces its message", async () => {
    const { user } = await load([
      alert("alert-1"),
      alert("alert-2", { sound: null, tts: speech("Welcome") }),
    ]);

    await user.click(rows()[1].getByRole("button", { name: "TTS: Welcome" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("Speak a message")).toBeInTheDocument();
    expect(dialog.getByPlaceholderText(/Type what the alert says/)).toHaveValue(
      "Welcome",
    );

    await send(APP_EVENTS_RESPONSE.GET_SOUNDS, {
      success: true,
      data: [airhorn, bell],
    });
    await user.click(dialog.getByRole("tab", { name: "My sounds" }));
    await user.click(dialog.getByRole("button", { name: "Bell" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(rows()[1].getByRole("button", { name: "Bell" })).toBeInTheDocument();
    await wait(300);
    expect(saves()[0].items).toEqual([
      alert("alert-1"),
      alert("alert-2", { sound: bell, tts: null }),
    ]);
  });

  it("speaks a message instead of the sound, with the TTS page's voice", async () => {
    const { user } = await load([alert("alert-1")], (p) => {
      p.tts.voice = aria;
      p.tts.filters = { speed: 1.2, pitch: 0.9, volume: 100 };
    });

    await user.click(rows()[0].getByRole("button", { name: "Airhorn" }));
    const dialog = within(screen.getByRole("dialog"));
    await user.click(dialog.getByRole("tab", { name: "Text-to-speech" }));
    const use = dialog.getByRole("button", { name: "Use text-to-speech" });
    expect(use).toBeDisabled();

    await user.type(
      dialog.getByPlaceholderText(/Type what the alert says/),
      "Thanks for the follow",
    );
    await user.click(use);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      rows()[0].getByRole("button", { name: "TTS: Thanks for the follow" }),
    ).toBeInTheDocument();
    await wait(300);
    expect(saves()[0].items[0]).toEqual(
      alert("alert-1", {
        sound: null,
        tts: {
          voice: aria,
          message: "Thanks for the follow",
          speed: 1.2,
          pitch: 0.9,
        },
      }),
    );
  });

  it("closes the picker without changing the alert", async () => {
    const { user } = await load([alert("alert-1")]);

    await user.click(rows()[0].getByRole("button", { name: "Airhorn" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await wait(300);
    expect(saves()).toEqual([]);
  });

  it("uses the sound main saved for the alert", async () => {
    const { user } = await load([
      alert("alert-1", { sound: null, tts: speech("Welcome") }),
    ]);
    await user.click(rows()[0].getByRole("button", { name: "TTS: Welcome" }));
    await user.click(screen.getByRole("tab", { name: "My sounds" }));
    await user.click(browse());

    await send(APP_EVENTS_RESPONSE.SET_ALERT_SOUND, {
      success: true,
      id: "alert-1",
      sound: bell,
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await wait(300);
    expect(saves()[0].items[0]).toEqual(
      alert("alert-1", { sound: bell, tts: null }),
    );
  });

  it("keeps the picker open when main couldn't save the sound", async () => {
    const { user } = await load([alert("alert-1")]);
    await user.click(rows()[0].getByRole("button", { name: "Airhorn" }));

    await send(APP_EVENTS_RESPONSE.SET_ALERT_SOUND, {
      ...failure(),
      id: "alert-1",
    });

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Couldn't save that sound.",
    );
    await wait(300);
    expect(saves()).toEqual([]);
  });

  // A download started from another alert's picker can finish meanwhile
  it("uses a sound saved after its picker closed, keeping another picker open", async () => {
    const { user } = await load([alert("alert-1"), alert("alert-2")]);
    await user.click(rows()[0].getByRole("button", { name: "Airhorn" }));
    await download(user);
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    await user.click(rows()[1].getByRole("button", { name: "Airhorn" }));

    await send(APP_EVENTS_RESPONSE.SET_ALERT_SOUND, {
      success: true,
      id: "alert-1",
      sound: bell,
    });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(rows()[0].getByRole("button", { name: "Bell" })).toBeInTheDocument();
  });

  it("ignores a download that finishes after another sound was picked", async () => {
    const { user } = await load([alert("alert-1")]);
    await user.click(rows()[0].getByRole("button", { name: "Airhorn" }));
    await send(APP_EVENTS_RESPONSE.GET_SOUNDS, {
      success: true,
      data: [airhorn, bell],
    });
    await download(user);
    const dialog = within(screen.getByRole("dialog"));
    await user.click(dialog.getByRole("tab", { name: "My sounds" }));
    await user.click(dialog.getByRole("button", { name: "Bell" }));

    await send(APP_EVENTS_RESPONSE.SET_ALERT_SOUND, {
      success: true,
      id: "alert-1",
      sound: alertSound("Bruh"),
    });

    expect(rows()[0].getByRole("button", { name: "Bell" })).toBeInTheDocument();
    await wait(300);
    expect(saves().at(-1)?.items[0]).toEqual(alert("alert-1", { sound: bell }));
  });

  it("tests an alert's sound or message", async () => {
    const message = speech("Welcome");
    const { user } = await load([
      alert("alert-1"),
      alert("alert-2", { sound: null, tts: message, volume: 50 }),
    ]);

    await user.click(rows()[0].getByRole("button", { name: "Play" }));
    expect(sent(APP_EVENTS.TEST_ALERT)).toEqual([
      { id: "alert-1", file: "airhorn.mp3", volume: 80 },
    ]);
    expect(
      rows()[0].getByRole("button", { name: "Cancel" }),
    ).toBeInTheDocument();

    await user.click(rows()[1].getByRole("button", { name: "Play" }));
    expect(sent(APP_EVENTS.TEST_ALERT)[1]).toEqual({
      id: "alert-2",
      tts: message,
      trigger: TOKIO_EVENTS.FOLLOW,
      volume: 50,
    });
  });
});
