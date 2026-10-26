import { Alert, AlertSound, Profile } from "@/common/schemas";
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
  alertMedia,
  mediaFile,
  profileReply,
  voice,
} from "@test/fixtures";
import { intersect } from "@test/dom";
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
// A library sound on an alert, played whole
const whole = (sound: AlertSound) => ({ ...sound, start: 0, end: null });

const alert = (id: string, patch: Partial<Alert> = {}): Alert => ({
  id,
  name: id,
  enabled: true,
  trigger: {
    type: TOKIO_EVENTS.FOLLOW,
    gifts: [],
    every_gift: false,
    emotes: [],
    keyword: "",
    user: "",
    min_coins: 0,
    roles: [],
  },
  sound: whole(airhorn),
  tts: null,
  media: null,
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

// An alert's row, where its Remove button sits
const rows = () =>
  screen
    .queryAllByRole("button", { name: "Remove" })
    .filter((button) => !button.closest("[role=dialog]"))
    .map((button) => within(button.parentElement!));
// What a row says about its alert, which opens its editor
const summary = (row: number) => rows()[row].getByTitle("Edit alert");

// The editor, and the dialog on top of it: a picker, or the editor itself
const editor = () => within(screen.getAllByRole("dialog")[0]);
const top = () => within(screen.getAllByRole("dialog").at(-1)!);
const dialogs = () => screen.queryAllByRole("dialog");

// Opens the editor of the alert in the row, on one of its tabs
async function edit(user: UserEvent, row: number, tab?: "Sound" | "Media") {
  await user.click(summary(row));
  if (tab) await user.click(editor().getByRole("tab", { name: tab }));
  return editor();
}

// Opens the sound picker of the alert in the row, over its editor
async function pickSound(user: UserEvent, row: number) {
  const opened = await edit(user, row, "Sound");
  await user.click(
    opened.getByRole("button", { name: /^(Change|Choose sound)\.\.\.$/ }),
  );
  return top();
}

const addAlert = () => screen.getByRole("button", { name: "Add alert" });
// Asks main for a file's sound, which it answers with SET_ALERT_SOUND
const browse = () => top().getByRole("button", { name: "Browse file..." });
// Starts downloading a MyInstants sound in the open picker
async function download(user: UserEvent) {
  const dialog = top();
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
    expect(summary(0)).toHaveTextContent("Follow");
    expect(summary(0)).toHaveTextContent("Airhorn");
    expect(follow.getByRole("checkbox")).toBeChecked();

    expect(summary(1)).toHaveTextContent("Share");
    expect(summary(1)).toHaveTextContent("“Thanks for sharing”");
    expect(share.getByRole("checkbox")).not.toBeChecked();
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
    expect(summary(0)).toHaveTextContent("Follow");
    expect(summary(0)).toHaveTextContent("No sound");
    expect(added.getByRole("button", { name: "Play" })).toBeDisabled();

    await wait(300);
    expect(saves()).toEqual([
      {
        simultaneous: false,
        queue_length: 100,
        items: [
          {
            id: expect.any(String),
            name: "alert-1",
            enabled: true,
            trigger: trigger(TOKIO_EVENTS.FOLLOW),
            sound: null,
            tts: null,
            media: null,
            volume: 100,
          },
        ],
      },
    ]);
  });

  it("names a new alert by its place, and renames it in its editor", async () => {
    const { user } = await load([alert("Welcome")]);

    await user.click(addAlert());
    expect(summary(1)).toHaveTextContent("alert-2");

    const opened = await edit(user, 1);
    const name = opened.getByRole("textbox", { name: "Name" });
    await user.clear(name);
    // Its place's name while it has none
    expect(summary(1)).toHaveTextContent("alert-2");
    expect(name).toHaveAttribute("placeholder", "alert-2");
    await user.type(name, "Big gifts");

    await wait(300);
    expect(
      saves()
        .at(-1)
        ?.items.map((a) => a.name),
    ).toEqual(["Welcome", "Big gifts"]);
    expect(summary(1)).toHaveTextContent("Big gifts");
  });

  it("finds alerts by name, and shows a new one", async () => {
    const { user } = await load([alert("Welcome"), alert("Big gifts")]);

    await user.click(screen.getByRole("button", { name: "Search" }));
    const search = screen.getByPlaceholderText("Search alerts...");
    await user.type(search, "GIFT");
    expect(rows()).toHaveLength(1);
    expect(summary(0)).toHaveTextContent("Big gifts");

    await user.type(search, "zzz");
    expect(rows()).toHaveLength(0);
    expect(screen.getByText("No alerts found.")).toBeInTheDocument();

    // The search would hide it
    await user.click(addAlert());
    expect(search).toHaveValue("");
    expect(rows()).toHaveLength(3);
  });

  it("shows another add button under the alerts while the header's is out of view", async () => {
    const { user } = await load([alert("alert-1")]);
    const adds = () => screen.getAllByRole("button", { name: "Add alert" });
    expect(adds()).toHaveLength(1);

    intersect(false);
    expect(adds()).toHaveLength(2);
    await user.click(adds()[1]);
    expect(rows()).toHaveLength(2);

    intersect();
    expect(adds()).toHaveLength(1);
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
    const { user, audio } = await load([alert("alert-1")]);
    expect(audio.value.setItemGain).toHaveBeenCalledWith("alert-1", 0.8);

    const opened = await edit(user, 0, "Sound");
    fireEvent.change(opened.getByRole("slider", { name: "Sound volume" }), {
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

    const opened = await edit(user, 0);
    await user.click(opened.getByRole("combobox", { name: "Event" }));
    await user.click(inList(container, "Chat")!);
    await user.type(opened.getByPlaceholderText("Any message"), "hello");

    expect(screen.getByRole("dialog", { name: "Chat alert" })).toBeVisible();

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

    await user.click((await edit(user, 0)).getByText("Any gift"));
    const dialog = top();
    await user.click(dialog.getByTitle("Lion"));
    await user.click(dialog.getByRole("button", { name: "Done" }));

    expect(summary(0)).toHaveTextContent("Lion");
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
    const listed = () =>
      top()
        .getAllByRole("checkbox")
        .map((box) => box.closest("label")!.title);

    await user.click((await edit(user, 0)).getByText("Any gift"));
    expect(listed()).toEqual(["Rose", "Lion", "Galaxy"]);
    await user.click(top().getByTitle("Galaxy"));
    await user.click(top().getByRole("button", { name: "Done" }));

    await user.click(editor().getByText("Galaxy"));

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

    await user.click((await edit(user, 0)).getByText("Any gift"));
    const dialog = top();
    expect(dialog.queryByTitle("Rose")).not.toBeNull();
    expect(dialog.queryByTitle("Galaxy")).not.toBeNull();
    expect(dialog.queryByTitle("Comet")).toBeNull();

    // While the picker is open
    await send(APP_EVENTS_RESPONSE.CUSTOM_GIFTS, {
      data: [gift(9, "Galaxy"), gift(5, "Comet")],
    });
    await user.click(dialog.getByTitle("Comet"));
    await user.click(dialog.getByRole("button", { name: "Done" }));

    expect(summary(0)).toHaveTextContent("Comet");
    await wait(300);
    expect(saves()[0].items[0].trigger.gifts).toEqual([5]);
  });

  it("offers the emotes seen in chat, numbered, as they arrive", async () => {
    const { user } = await load(
      [alert("alert-1", { trigger: trigger(EMOTE_TRIGGER) })],
      (p) => {
        p.emotes = [{ id: "e1", image: "e1.png" }];
      },
    );

    await user.click((await edit(user, 0)).getByText("Any emote"));
    const dialog = top();
    expect(dialog.queryByTitle("Emote 1")).not.toBeNull();
    expect(dialog.queryByTitle("Emote 2")).toBeNull();

    // While the picker is open
    await send(APP_EVENTS_RESPONSE.EMOTES, {
      data: [
        { id: "e1", image: "e1.png" },
        { id: "e2", image: "e2.png" },
      ],
    });
    await user.click(dialog.getByTitle("Emote 2"));
    await user.click(dialog.getByRole("button", { name: "Done" }));

    expect(summary(0)).toHaveTextContent("Emote 2");
    await wait(300);
    expect(saves()[0].items[0].trigger.emotes).toEqual(["e2"]);
  });

  it("opens the sound picker for the alert, and a library sound replaces its message", async () => {
    const { user } = await load([
      alert("alert-1"),
      alert("alert-2", { sound: null, tts: speech("Welcome") }),
    ]);

    const dialog = await pickSound(user, 1);
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

    // Back to the editor
    expect(dialogs()).toHaveLength(1);
    expect(summary(1)).toHaveTextContent("Bell");
    await wait(300);
    expect(saves()[0].items).toEqual([
      alert("alert-1"),
      alert("alert-2", { sound: whole(bell), tts: null }),
    ]);
  });

  it("speaks a message instead of the sound, with the TTS page's voice", async () => {
    const { user } = await load([alert("alert-1")], (p) => {
      p.tts.voice = aria;
      p.tts.filters = { speed: 1.2, pitch: 0.9, volume: 100 };
    });

    const dialog = await pickSound(user, 0);
    await user.click(dialog.getByRole("tab", { name: "Text-to-speech" }));
    const use = dialog.getByRole("button", { name: "Use text-to-speech" });
    expect(use).toBeDisabled();

    await user.type(
      dialog.getByPlaceholderText(/Type what the alert says/),
      "Thanks for the follow",
    );
    await user.click(use);

    expect(dialogs()).toHaveLength(1);
    expect(summary(0)).toHaveTextContent("“Thanks for the follow”");
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

  it("clears an alert's sound, keeping it in the library", async () => {
    const { user } = await load([alert("alert-1")]);

    const dialog = await pickSound(user, 0);
    await user.click(dialog.getByRole("button", { name: "Clear" }));

    expect(dialogs()).toHaveLength(1);
    expect(summary(0)).toHaveTextContent("No sound");
    expect(sent(APP_EVENTS.REMOVE_SOUND)).toEqual([]);
    await wait(300);
    expect(saves()[0].items[0]).toEqual(alert("alert-1", { sound: null }));
  });

  it("closes the picker without changing the alert", async () => {
    const { user } = await load([alert("alert-1")]);

    const dialog = await pickSound(user, 0);
    await user.click(dialog.getByRole("button", { name: "Cancel" }));

    expect(dialogs()).toHaveLength(1);
    await wait(300);
    expect(saves()).toEqual([]);
  });

  it("uses the sound main saved for the alert", async () => {
    const { user } = await load([
      alert("alert-1", { sound: null, tts: speech("Welcome") }),
    ]);
    const dialog = await pickSound(user, 0);
    await user.click(dialog.getByRole("tab", { name: "My sounds" }));
    await user.click(browse());

    await send(APP_EVENTS_RESPONSE.SET_ALERT_SOUND, {
      success: true,
      id: "alert-1",
      request: 1,
      sound: bell,
    });

    expect(dialogs()).toHaveLength(1);
    await wait(300);
    expect(saves()[0].items[0]).toEqual(
      alert("alert-1", { sound: whole(bell), tts: null }),
    );
  });

  it("keeps the picker open when main couldn't save the sound", async () => {
    const { user } = await load([alert("alert-1")]);
    await pickSound(user, 0);
    await user.click(browse());

    await send(APP_EVENTS_RESPONSE.SET_ALERT_SOUND, {
      ...failure(),
      id: "alert-1",
      request: 1,
    });

    expect(dialogs().at(-1)).toHaveTextContent("Couldn't save that sound.");
    await wait(300);
    expect(saves()).toEqual([]);
  });

  // A download started from another alert's picker can finish meanwhile
  it("uses a sound saved after its picker closed, keeping another picker open", async () => {
    const { user } = await load([alert("alert-1"), alert("alert-2")]);
    await pickSound(user, 0);
    await download(user);
    await user.click(top().getByRole("button", { name: "Cancel" }));
    await user.click(editor().getByRole("button", { name: "Done" }));
    await pickSound(user, 1);

    await send(APP_EVENTS_RESPONSE.SET_ALERT_SOUND, {
      success: true,
      id: "alert-1",
      request: 1,
      sound: bell,
    });

    expect(dialogs()).toHaveLength(2);
    expect(summary(0)).toHaveTextContent("Bell");
  });

  it("ignores a download that finishes after another sound was picked", async () => {
    const { user } = await load([alert("alert-1")]);
    await pickSound(user, 0);
    await send(APP_EVENTS_RESPONSE.GET_SOUNDS, {
      success: true,
      data: [airhorn, bell],
    });
    await download(user);
    const dialog = top();
    await user.click(dialog.getByRole("tab", { name: "My sounds" }));
    await user.click(dialog.getByRole("button", { name: "Bell" }));

    await send(APP_EVENTS_RESPONSE.SET_ALERT_SOUND, {
      success: true,
      id: "alert-1",
      request: 1,
      sound: alertSound("Bruh"),
    });

    expect(summary(0)).toHaveTextContent("Bell");
    await wait(300);
    expect(saves().at(-1)?.items[0]).toEqual(
      alert("alert-1", { sound: whole(bell) }),
    );
  });

  it.each([
    ["in order", [1, 2]],
    ["the later one first", [2, 1]],
  ])("uses the later of two picks whose replies come %s", async (_, order) => {
    const { user } = await load([alert("alert-1")]);
    await pickSound(user, 0);
    await user.click(browse());
    await download(user);
    const sounds = [bell, alertSound("Bruh")];

    for (const request of order) {
      await send(APP_EVENTS_RESPONSE.SET_ALERT_SOUND, {
        success: true,
        id: "alert-1",
        request,
        sound: sounds[request - 1],
      });
    }

    expect(summary(0)).toHaveTextContent("Bruh");
    await wait(300);
    expect(saves().at(-1)?.items[0]).toEqual(
      alert("alert-1", { sound: whole(alertSound("Bruh")) }),
    );
  });

  it("still uses a download after a browse was cancelled", async () => {
    const { user } = await load([alert("alert-1")]);
    await pickSound(user, 0);
    await download(user);
    // Main sends no reply for a cancelled dialog
    await user.click(browse());

    await send(APP_EVENTS_RESPONSE.SET_ALERT_SOUND, {
      success: true,
      id: "alert-1",
      request: 1,
      sound: alertSound("Bruh"),
    });

    expect(summary(0)).toHaveTextContent("Bruh");
  });

  it("tests an alert's sound or message", async () => {
    const message = speech("Welcome");
    const { user } = await load([
      alert("alert-1"),
      alert("alert-2", { sound: null, tts: message, volume: 50 }),
    ]);

    await user.click(rows()[0].getByRole("button", { name: "Play" }));
    expect(sent(APP_EVENTS.TEST_ALERT)).toEqual([
      { id: "alert-1", file: "airhorn.mp3", volume: 80, start: 0, request: 1 },
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
      request: 2,
    });
  });

  describe("media", () => {
    const party = mediaFile("Party");
    const confetti = mediaFile("Confetti");
    const shown = (file = party, duration = 5) =>
      alertMedia(file, { duration });

    // Opens the media picker of the alert in the row over its editor, with
    // the library listed
    async function openMedia(user: UserEvent, row: number) {
      const opened = await edit(user, row, "Media");
      await user.click(
        opened.getByRole("button", { name: /^(Change|Choose media)\.\.\.$/ }),
      );
      await send(APP_EVENTS_RESPONSE.GET_MEDIA, {
        success: true,
        data: [party, confetti],
      });
      return top();
    }
    const duration = () =>
      editor().getByRole("spinbutton", { name: "Duration in seconds" });

    it("picks media for an alert from the library, for 5 seconds", async () => {
      const { user } = await load([alert("alert-1")]);

      const dialog = await openMedia(user, 0);
      await user.click(dialog.getByRole("button", { name: "Party" }));

      // Back to the editor, which shows how long
      expect(dialogs()).toHaveLength(1);
      expect(duration()).toHaveValue(5);
      expect(summary(0)).toHaveTextContent("Party");
      await wait(300);
      expect(saves()[0].items[0]).toEqual(alert("alert-1", { media: shown() }));
    });

    it("keeps the duration when the media changes, and drops it", async () => {
      const { user } = await load([
        alert("alert-1", { media: shown(party, 9) }),
      ]);

      const dialog = await openMedia(user, 0);
      await user.click(dialog.getByRole("button", { name: "Confetti" }));
      await wait(300);
      expect(saves().at(-1)?.items[0].media).toEqual(shown(confetti, 9));

      fireEvent.change(duration(), { target: { value: "12" } });
      await wait(300);
      expect(saves().at(-1)?.items[0].media).toEqual(shown(confetti, 12));

      await user.click(editor().getByRole("button", { name: "Change..." }));
      await user.click(top().getByRole("button", { name: "Clear" }));
      await wait(300);
      expect(saves().at(-1)?.items[0].media).toBeNull();
    });

    it("uses a browsed file only for the alert waiting for one", async () => {
      const { user } = await load([alert("alert-1"), alert("alert-2")]);
      const dialog = await openMedia(user, 0);
      await user.click(dialog.getByRole("button", { name: "Browse file..." }));

      await send(APP_EVENTS_RESPONSE.SET_ALERT_MEDIA, {
        success: true,
        id: "alert-2",
        request: 1,
        media: confetti,
      });
      await send(APP_EVENTS_RESPONSE.SET_ALERT_MEDIA, {
        success: true,
        id: "alert-1",
        request: 1,
        media: party,
      });

      expect(dialogs()).toHaveLength(1);
      expect(summary(0)).toHaveTextContent("Party");
      expect(summary(1)).toHaveTextContent("No media");
    });

    it("takes a deleted file off the alerts it shows", async () => {
      await load([
        alert("alert-1", { media: shown() }),
        alert("alert-2", { sound: whole(bell), media: shown(confetti) }),
      ]);

      await send(APP_EVENTS_RESPONSE.ALERT_FILE_REMOVED, {
        field: "sound",
        file: airhorn.file,
      });
      await send(APP_EVENTS_RESPONSE.ALERT_FILE_REMOVED, {
        field: "media",
        file: party.file,
      });

      expect(summary(0)).toHaveTextContent("No sound");
      expect(summary(0)).toHaveTextContent("No media");
      await wait(300);
      expect(saves().at(-1)?.items).toEqual([
        alert("alert-1", { sound: null }),
        alert("alert-2", { sound: whole(bell), media: shown(confetti) }),
      ]);
    });

    it("keeps the duration when another file is picked", async () => {
      const { user } = await load([
        alert("alert-1", { media: alertMedia(party, { duration: 9 }) }),
      ]);

      const dialog = await openMedia(user, 0);
      await user.click(dialog.getByRole("button", { name: "Confetti" }));

      await wait(300);
      expect(saves().at(-1)?.items[0].media).toEqual(
        alertMedia(confetti, { duration: 9 }),
      );
    });

    it("keeps a cut when the same file is picked again, not for another", async () => {
      const cut = alertMedia(party, { start: 1, end: 2 });
      const { user } = await load([alert("alert-1", { media: cut })]);

      let dialog = await openMedia(user, 0);
      await user.click(dialog.getByRole("button", { name: "Party" }));
      await wait(300);
      expect(saves()).toEqual([]);

      dialog = await openMedia(user, 0);
      await user.click(dialog.getByRole("button", { name: "Confetti" }));
      await wait(300);
      expect(saves().at(-1)?.items[0].media).toEqual(alertMedia(confetti));
    });

    it("shows a video while it plays, and saves it", async () => {
      const clip = { name: "Clip", file: "clip.webm" };
      const { user } = await load([
        alert("alert-1", { media: alertMedia(clip) }),
      ]);
      await edit(user, 0, "Media");
      const video = screen.getByRole("dialog").querySelector("video")!;
      Object.defineProperty(video, "duration", { value: 7.4 });
      fireEvent.loadedMetadata(video);

      await wait(300);
      expect(saves().at(-1)?.items[0].media).toEqual(
        alertMedia(clip, { duration: 7.4 }),
      );
      expect(summary(0)).toHaveTextContent("7.4s");
    });

    it.each([
      ["in order", [1, 2]],
      ["the later one first", [2, 1]],
    ])(
      "uses the later of two browsed files whose replies come %s",
      async (_, order) => {
        const { user } = await load([alert("alert-1")]);
        const dialog = await openMedia(user, 0);
        const browse = dialog.getByRole("button", { name: "Browse file..." });
        await user.click(browse);
        await user.click(browse);
        const files = [party, confetti];

        for (const request of order) {
          await send(APP_EVENTS_RESPONSE.SET_ALERT_MEDIA, {
            success: true,
            id: "alert-1",
            request,
            media: files[request - 1],
          });
        }

        expect(summary(0)).toHaveTextContent("Confetti");
        await wait(300);
        expect(saves().at(-1)?.items[0].media).toEqual(shown(confetti));
      },
    );

    it("ignores a browsed file that comes after a pick", async () => {
      const { user } = await load([alert("alert-1")]);
      const dialog = await openMedia(user, 0);
      await user.click(dialog.getByRole("button", { name: "Browse file..." }));
      await user.click(dialog.getByRole("button", { name: "Confetti" }));

      await send(APP_EVENTS_RESPONSE.SET_ALERT_MEDIA, {
        success: true,
        id: "alert-1",
        request: 1,
        media: party,
      });

      expect(summary(0)).toHaveTextContent("Confetti");
    });
  });

  describe("editor", () => {
    const ding = new Uint8Array([1, 2, 3]);

    // Main's reply to the waveform's request, then the decode
    async function waveform() {
      await send(APP_EVENTS_RESPONSE.SOUND_DATA, {
        success: true,
        file: "airhorn.mp3",
        data: ding,
      });
      await act(async () => {});
    }

    it("cuts an alert's sound on its waveform, and tests the cut", async () => {
      const { user, audio } = await load([alert("alert-1")]);
      const opened = await edit(user, 0, "Sound");
      expect(sent(APP_EVENTS.GET_SOUND_DATA)).toEqual([
        { file: "airhorn.mp3" },
      ]);

      await waveform();
      // The queues' decode, by the key main plays it with
      expect(audio.value.decode).toHaveBeenCalledWith(ding, "airhorn.mp3");
      // The fake sound lasts 2 seconds; Shift moves a handle by one
      fireEvent.keyDown(opened.getByRole("slider", { name: "Start" }), {
        key: "ArrowRight",
        shiftKey: true,
      });
      fireEvent.change(opened.getByRole("spinbutton", { name: "End" }), {
        target: { value: "1.5" },
      });

      expect(opened.getByText("Plays 0.5s of 2s")).toBeInTheDocument();
      // How long the cut plays
      expect(summary(0)).toHaveTextContent("0.5s");
      await wait(300);
      expect(saves().at(-1)?.items[0].sound).toEqual({
        ...whole(airhorn),
        start: 1,
        end: 1.5,
      });

      await user.click(opened.getByRole("button", { name: "Play" }));
      expect(sent(APP_EVENTS.TEST_ALERT)).toEqual([
        {
          id: "alert-1",
          file: "airhorn.mp3",
          volume: 80,
          start: 1,
          end: 1.5,
          request: 1,
        },
      ]);

      await user.click(opened.getByRole("button", { name: "Reset cut" }));
      await wait(300);
      expect(saves().at(-1)?.items[0].sound).toEqual(whole(airhorn));
    });

    it("plays to the sound's end once the end handle reaches it", async () => {
      const { user } = await load([
        alert("alert-1", { sound: { ...whole(airhorn), end: 1 } }),
      ]);
      const opened = await edit(user, 0, "Sound");
      await waveform();

      fireEvent.keyDown(opened.getByRole("slider", { name: "End" }), {
        key: "End",
      });

      await wait(300);
      expect(saves().at(-1)?.items[0].sound?.end).toBeNull();
    });

    it("keeps a sound's cut when the same sound is picked again", async () => {
      const cut = { ...whole(airhorn), start: 0.5, end: 1 };
      const { user } = await load([alert("alert-1", { sound: cut })]);
      const dialog = await pickSound(user, 0);
      await send(APP_EVENTS_RESPONSE.GET_SOUNDS, {
        success: true,
        data: [airhorn, bell],
      });

      await user.click(dialog.getByRole("button", { name: "Airhorn" }));
      expect(summary(0)).toHaveTextContent("0.5s");
      await wait(300);
      expect(saves()).toEqual([]);

      await pickSound(user, 0);
      await send(APP_EVENTS_RESPONSE.GET_SOUNDS, {
        success: true,
        data: [airhorn, bell],
      });
      await user.click(top().getByRole("button", { name: "Bell" }));
      await wait(300);
      expect(saves().at(-1)?.items[0].sound).toEqual(whole(bell));
    });

    it("says when it can't read the sound", async () => {
      const { user } = await load([alert("alert-1")]);
      const opened = await edit(user, 0, "Sound");

      await send(APP_EVENTS_RESPONSE.SOUND_DATA, {
        ...failure(),
        file: "other.mp3",
      });
      expect(opened.queryByText("Couldn't read this sound.")).toBeNull();
      await send(APP_EVENTS_RESPONSE.SOUND_DATA, {
        ...failure(),
        file: "airhorn.mp3",
      });

      expect(opened.getByText("Couldn't read this sound.")).toBeInTheDocument();
    });

    // Airhorn's decode, which ends once Bell was picked in its place
    async function lateDecode(ok: boolean) {
      const app = await load([alert("alert-1")]);
      const decode = app.audio.value.decode;
      const decoded = decode.getMockImplementation()!;
      let end = () => {};
      decode.mockImplementationOnce(
        (data, key) =>
          new Promise((resolve, reject) => {
            end = () =>
              ok ? resolve(decoded(data, key)) : reject(new Error("Bad data."));
          }),
      );
      const dialog = await pickSound(app.user, 0);
      await waveform();
      await send(APP_EVENTS_RESPONSE.GET_SOUNDS, {
        success: true,
        data: [airhorn, bell],
      });
      await app.user.click(dialog.getByRole("button", { name: "Bell" }));
      return () => act(async () => end());
    }

    it("keeps the new sound's waveform when the old one's decode ends late", async () => {
      const end = await lateDecode(true);
      await send(APP_EVENTS_RESPONSE.SOUND_DATA, {
        success: true,
        file: bell.file,
        data: new Uint8Array([4]),
      });
      await act(async () => {});
      expect(editor().getByRole("slider", { name: "Start" })).toBeVisible();

      await end();

      expect(editor().getByRole("slider", { name: "Start" })).toBeVisible();
    });

    it("keeps the new sound's failure when the old one's decode fails late", async () => {
      const end = await lateDecode(false);
      await send(APP_EVENTS_RESPONSE.SOUND_DATA, {
        ...failure(),
        file: bell.file,
      });

      await end();

      expect(
        editor().getByText("Couldn't read this sound."),
      ).toBeInTheDocument();
    });

    it("doesn't cut a message", async () => {
      const { user } = await load([
        alert("alert-1", { sound: null, tts: speech("Welcome") }),
      ]);

      const opened = await edit(user, 0, "Sound");

      expect(opened.getByText(/Messages play whole/)).toBeInTheDocument();
      expect(opened.queryByRole("slider", { name: "Start" })).toBeNull();
      expect(sent(APP_EVENTS.GET_SOUND_DATA)).toEqual([]);
    });

    it("sets the coins a gift is worth and the viewers' roles", async () => {
      const { user } = await load([
        alert("alert-1", { trigger: trigger(TOKIO_EVENTS.GIFT) }),
      ]);
      const opened = await edit(user, 0);
      expect(opened.getByText(/The whole streak's coins/)).toBeInTheDocument();

      fireEvent.change(opened.getByRole("spinbutton", { name: "Coins" }), {
        target: { value: "100" },
      });
      await user.click(opened.getByRole("checkbox", { name: "Moderators" }));
      await user.click(opened.getByRole("checkbox", { name: "Super Fans" }));
      await user.click(opened.getByRole("checkbox", { name: "Super Fans" }));

      expect(summary(0)).toHaveTextContent(
        "Any gift, when the streak ends, worth 100+ coins, from Moderators",
      );
      await wait(300);
      expect(saves().at(-1)?.items[0].trigger).toMatchObject({
        min_coins: 100,
        roles: ["moderator"],
      });
    });

    it.each([
      TOKIO_EVENTS.ENVELOPE,
      TOKIO_EVENTS.FOLLOW,
      TOKIO_EVENTS.LIKE,
      TOKIO_EVENTS.SHARE,
      TOKIO_EVENTS.MEMBER_JOIN,
      TOKIO_EVENTS.SUPER_FAN,
      TOKIO_EVENTS.SUPER_FAN_JOIN,
    ] as const)("offers no roles or coins for %s", async (type) => {
      const { user } = await load([
        alert("alert-1", { trigger: trigger(type) }),
      ]);

      const opened = await edit(user, 0);

      expect(opened.queryByRole("group", { name: "From" })).toBeNull();
      expect(
        opened.queryByRole("group", { name: "Worth at least" }),
      ).toBeNull();
    });

    it("offers the coins only for any gift", async () => {
      const { user } = await load([
        alert("alert-1", {
          trigger: { ...trigger(TOKIO_EVENTS.GIFT), gifts: [1] },
        }),
      ]);

      const opened = await edit(user, 0);

      expect(
        opened.queryByRole("group", { name: "Worth at least" }),
      ).toBeNull();
      expect(opened.getByRole("group", { name: "From" })).toBeInTheDocument();
    });

    it("tests a message next to it, and sets its volume", async () => {
      const { user } = await load([
        alert("alert-1", { sound: null, tts: speech("Welcome") }),
      ]);
      const opened = await edit(user, 0, "Sound");

      await user.click(opened.getByRole("button", { name: "Play" }));
      fireEvent.change(opened.getByRole("slider", { name: "Sound volume" }), {
        target: { value: "45" },
      });

      expect(sent(APP_EVENTS.TEST_ALERT)).toHaveLength(1);
      await wait(300);
      expect(saves().at(-1)?.items[0].volume).toBe(45);
    });

    it("has no volume or test without a sound", async () => {
      const { user } = await load([alert("alert-1", { sound: null })]);

      const opened = await edit(user, 0, "Sound");

      expect(opened.queryByRole("slider")).toBeNull();
      expect(opened.queryByRole("button", { name: "Play" })).toBeNull();
    });

    it("closes the picker over it first, then itself", async () => {
      const { user } = await load([alert("alert-1")]);
      await pickSound(user, 0);
      expect(dialogs()).toHaveLength(2);

      await user.keyboard("{Escape}");
      expect(dialogs()).toHaveLength(1);
      // The focus went back to the button that opened the picker
      expect(editor().getByRole("button", { name: "Change..." })).toHaveFocus();

      await user.keyboard("{Escape}");
      expect(dialogs()).toHaveLength(0);
    });

    it("closes when its alert is gone", async () => {
      const { user } = await load([alert("alert-1")]);
      await edit(user, 0);

      await send(
        APP_EVENTS_RESPONSE.GET_PROFILE,
        profileReply((p) => {
          p.alerts.items = [];
        }),
      );

      expect(dialogs()).toHaveLength(0);
    });
  });
});
