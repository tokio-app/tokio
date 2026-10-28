import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { engine, failure, profileReply, voice } from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { section } from "@test/queries";
import { renderWithProviders } from "@test/render";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TTS } from ".";

const aria = voice("en-US-AriaNeural");
const guy = voice("en-US-GuyNeural");
const data = new Uint8Array([1, 2, 3]);

const loaded = profileReply((p) => {
  p.tts.voice = aria;
  p.tts.filters = { speed: 1.5, pitch: 0.8, volume: 70 };
  p.tts.format = {
    template: "{username} says {comment}",
    trigger: { mode: "custom", value: "!say" },
    remove_emojis: true,
  };
  p.tts.replacements = [{ old: "brb", new: "be right back" }];
  p.tts.protection = {
    cooldown: 5,
    queue_length: 20,
    comment_length: 150,
    banned: ["spoiler", "ad"],
  };
});

// The field under a label: the label and its control share a div
const field = (label: string | RegExp) =>
  within(screen.getByText(label).closest("div")!);

const testButton = () => screen.getByRole("button", { name: "Test voice" });
const testMessage = () =>
  screen.getByPlaceholderText("Type a message to test how the TTS sounds...");
const customTrigger = () => screen.getByPlaceholderText("!tts");
const template = () => field("Message template").getByRole("textbox");
const mode = (label: RegExp) => screen.getByRole("radio", { name: label });
const removeEmojis = () =>
  screen.getByRole("checkbox", { name: "Remove emojis" });

async function setup(reply = loaded) {
  const app = renderWithProviders(<TTS />, {
    user: { advanceTimers: (ms) => vi.advanceTimersByTime(ms) },
  });
  await send(APP_EVENTS_RESPONSE.GET_PROFILE, reply);
  return { ...app, queue: app.audio.queue("tts_test") };
}

const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

// The settings saved once the changes settle
async function saved() {
  await wait(300);
  return sent(APP_EVENTS.UPDATE_TTS_SETTINGS).at(-1)!.settings;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TTS", () => {
  it("asks main for the profile and the voices", () => {
    renderWithProviders(<TTS />);

    expect(sent(APP_EVENTS.GET_PROFILE)).toHaveLength(1);
    expect(sent(APP_EVENTS.GET_VOICES)).toHaveLength(1);
  });

  it("fills in the loaded settings", async () => {
    await setup();

    expect(
      screen.getByRole("button", { name: /en-US-AriaNeural/ }),
    ).toBeInTheDocument();
    expect(field("Speed (1.5x)").getByRole("slider")).toHaveValue("1.5");
    expect(field("Pitch (0.8)").getByRole("slider")).toHaveValue("0.8");
    expect(field("Volume (70%)").getByRole("slider")).toHaveValue("70");

    expect(mode(/Custom command/)).toBeChecked();
    expect(customTrigger()).toHaveValue("!say");
    expect(customTrigger()).toBeEnabled();
    expect(template()).toHaveValue("{username} says {comment}");
    expect(removeEmojis()).toBeChecked();

    expect(screen.getByPlaceholderText(/Word to replace/)).toHaveValue("brb");
    expect(screen.getByPlaceholderText(/How it sounds/)).toHaveValue(
      "be right back",
    );

    expect(field("Cooldown").getByRole("spinbutton")).toHaveValue(5);
    expect(field("Max queue length").getByRole("spinbutton")).toHaveValue(20);
    expect(field("Max message length").getByRole("spinbutton")).toHaveValue(
      150,
    );
    expect(screen.getByPlaceholderText("word1, word2, word3...")).toHaveValue(
      "spoiler, ad",
    );
  });

  it("applies the loaded filters to the test queue", async () => {
    const { queue } = await setup();

    expect(queue.setFilters).toHaveBeenCalledWith({
      speed: 1.5,
      pitch: 0.8,
      volume: 0.7,
    });
  });

  it("saves a change 300ms later", async () => {
    const { user } = await setup();

    await user.type(template(), "!");
    await wait(299);
    expect(sent(APP_EVENTS.UPDATE_TTS_SETTINGS)).toEqual([]);

    await wait(1);
    expect(sent(APP_EVENTS.UPDATE_TTS_SETTINGS)).toEqual([
      {
        settings: {
          ...loaded.profile.tts,
          format: {
            ...loaded.profile.tts.format,
            template: "{username} says {comment}!",
          },
        },
      },
    ]);
  });

  it("tests the voice only with a message", async () => {
    const { user } = await setup();
    expect(testButton()).toBeDisabled();

    await user.type(testMessage(), "Hi");
    expect(testButton()).toBeEnabled();

    await user.clear(testMessage());
    expect(testButton()).toBeDisabled();
  });

  it("tests the voice with the message, loading until main answers", async () => {
    const { user, queue } = await setup();
    const test = testButton();

    await user.type(testMessage(), "Hello chat");
    await user.click(test);

    expect(sent(APP_EVENTS.GET_TTS_TEST)).toEqual([
      {
        id: "tts-test",
        text: "Hello chat",
        voice: aria,
        settings: loaded.profile.tts,
      },
    ]);
    expect(test).toHaveAttribute("aria-busy", "true");

    await send(APP_EVENTS_RESPONSE.GET_TTS_TEST, {
      success: true,
      id: "tts-test",
      data,
    });

    expect(queue.enqueue).toHaveBeenCalledWith(data);
    expect(test).not.toHaveAttribute("aria-busy");
  });

  it("cuts the test playing when another one comes", async () => {
    const { user, queue } = await setup();
    await user.type(testMessage(), "Hello chat");
    const reply = { success: true, id: "tts-test", data };

    await user.click(testButton());
    await send(APP_EVENTS_RESPONSE.GET_TTS_TEST, reply);
    await user.click(testButton());
    await send(APP_EVENTS_RESPONSE.GET_TTS_TEST, reply);

    const [, second] = queue.enqueue.mock.invocationCallOrder;
    expect(queue.stop).toHaveBeenCalledTimes(2);
    expect(queue.stop.mock.invocationCallOrder[1]).toBeLessThan(second);
  });

  it("stops the test when the page closes", async () => {
    const { user, queue, unmount } = await setup();
    await user.type(testMessage(), "Hello chat");
    await user.click(testButton());
    await send(APP_EVENTS_RESPONSE.GET_TTS_TEST, {
      success: true,
      id: "tts-test",
      data,
    });
    queue.stop.mockClear();

    unmount();

    expect(queue.stop).toHaveBeenCalledOnce();
  });

  it("stops loading without playing when the test fails", async () => {
    const { user, queue } = await setup();
    const test = testButton();
    await user.type(testMessage(), "Hello chat");
    await user.click(test);

    await send(APP_EVENTS_RESPONSE.GET_TTS_TEST, {
      ...failure(),
      id: "tts-test",
    });

    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(test).not.toHaveAttribute("aria-busy");
  });

  it("ignores test replies meant for voice previews", async () => {
    const { user, queue } = await setup();
    const test = testButton();
    await user.type(testMessage(), "Hello chat");
    await user.click(test);

    await send(APP_EVENTS_RESPONSE.GET_TTS_TEST, {
      success: true,
      id: "voice-preview:edge|en-US|en-US-AriaNeural",
      data,
    });

    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(test).toHaveAttribute("aria-busy", "true");
  });

  it("tests and saves the voice picked from the list", async () => {
    const { user } = await setup();
    await send(APP_EVENTS_RESPONSE.GET_VOICES, {
      success: true,
      voices: [aria, guy],
      engines: [engine("edge", "Edge")],
    });

    await user.click(screen.getByRole("button", { name: /en-US-AriaNeural/ }));
    await user.click(
      within(screen.getByRole("dialog")).getByTitle("en-US-GuyNeural"),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.type(testMessage(), "Hello chat");
    await user.click(testButton());

    expect(sent(APP_EVENTS.GET_TTS_TEST)).toEqual([
      {
        id: "tts-test",
        text: "Hello chat",
        voice: guy,
        settings: { ...loaded.profile.tts, voice: guy },
      },
    ]);
    expect((await saved()).voice).toEqual(guy);
  });

  it("tests with the settings on the page, saved or not", async () => {
    const { user } = await setup();
    await user.click(removeEmojis());

    await user.type(testMessage(), "Hello chat");
    await user.click(testButton());

    expect(sent(APP_EVENTS.GET_TTS_TEST).at(-1)?.settings).toEqual({
      ...loaded.profile.tts,
      format: { ...loaded.profile.tts.format, remove_emojis: false },
    });
  });

  it("changes the filters and the test queue's with the sliders", async () => {
    const { queue } = await setup();

    fireEvent.change(field("Speed (1.5x)").getByRole("slider"), {
      target: { value: "1.2" },
    });
    expect(queue.setFilters).toHaveBeenLastCalledWith({ speed: 1.2 });

    fireEvent.change(field("Pitch (0.8)").getByRole("slider"), {
      target: { value: "1.3" },
    });
    expect(queue.setFilters).toHaveBeenLastCalledWith({ pitch: 1.3 });

    fireEvent.change(field("Volume (70%)").getByRole("slider"), {
      target: { value: "40" },
    });
    expect(queue.setFilters).toHaveBeenLastCalledWith({ volume: 0.4 });

    expect(screen.getByText("Speed (1.2x)")).toBeInTheDocument();
    expect(screen.getByText("Pitch (1.3)")).toBeInTheDocument();
    expect(screen.getByText("Volume (40%)")).toBeInTheDocument();
    expect((await saved()).filters).toEqual({
      speed: 1.2,
      pitch: 1.3,
      volume: 40,
    });
  });

  it("sets the trigger of each format mode", async () => {
    const { user } = await setup();

    await user.click(mode(/Read all messages/));
    expect((await saved()).format.trigger).toEqual({
      mode: "any",
      value: "",
    });
    expect(customTrigger()).toBeDisabled();
    expect(customTrigger()).toHaveValue("");

    await user.click(mode(/Dot prefix/));
    expect((await saved()).format.trigger).toEqual({
      mode: "dot",
      value: ".",
    });

    await user.click(mode(/Slash prefix/));
    expect((await saved()).format.trigger).toEqual({
      mode: "slash",
      value: "/",
    });

    await user.click(mode(/Custom command/));
    expect(customTrigger()).toBeEnabled();
    expect(customTrigger()).toHaveValue("!tts");
    expect((await saved()).format.trigger).toEqual({
      mode: "custom",
      value: "!tts",
    });

    await user.clear(customTrigger());
    await user.type(customTrigger(), "!speak");
    expect((await saved()).format.trigger).toEqual({
      mode: "custom",
      value: "!speak",
    });
  });

  it("turns emoji removal off", async () => {
    const { user } = await setup();

    await user.click(removeEmojis());

    expect(removeEmojis()).not.toBeChecked();
    expect((await saved()).format.remove_emojis).toBe(false);
  });

  it("adds a clicked variable to the template", async () => {
    const { user } = await setup();

    await user.click(screen.getByRole("button", { name: "{handle}" }));

    expect(template()).toHaveValue("{username} says {comment}{handle}");
    expect((await saved()).format.template).toBe(
      "{username} says {comment}{handle}",
    );
  });

  it("adds, edits and removes replacements", async () => {
    const { user } = await setup(profileReply());
    const replacements = section("Replacements");
    expect(replacements.getByText("No replacements yet.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add replacement" }));
    expect(
      replacements.queryByText("No replacements yet."),
    ).not.toBeInTheDocument();
    expect(replacements.getByPlaceholderText(/Word to replace/)).toHaveValue(
      "",
    );

    await user.type(replacements.getByPlaceholderText(/Word to replace/), "gg");
    await user.type(
      replacements.getByPlaceholderText(/How it sounds/),
      "good game",
    );
    expect((await saved()).replacements).toEqual([
      { old: "gg", new: "good game" },
    ]);

    await user.click(replacements.getByRole("button", { name: "Remove" }));
    expect(replacements.getByText("No replacements yet.")).toBeInTheDocument();
    expect((await saved()).replacements).toEqual([]);
  });

  it("removes the replacement whose button is clicked", async () => {
    const { user } = await setup(
      profileReply((p) => {
        p.tts.replacements = [
          { old: "brb", new: "be right back" },
          { old: "gg", new: "good game" },
        ];
      }),
    );

    const [removeFirst] = screen.getAllByRole("button", { name: "Remove" });
    await user.click(removeFirst);

    expect(screen.getByPlaceholderText(/Word to replace/)).toHaveValue("gg");
    expect((await saved()).replacements).toEqual([
      { old: "gg", new: "good game" },
    ]);
  });

  it("adds a special user, picks their voice and removes them", async () => {
    const { user } = await setup();
    const users = section("Special users");
    expect(users.getByText("No special users yet.")).toBeInTheDocument();

    await user.click(users.getByRole("button", { name: "Add user" }));
    await user.type(users.getByPlaceholderText("@handle"), "@alice");
    await send(APP_EVENTS_RESPONSE.GET_VOICES, {
      success: true,
      voices: [aria, guy],
      engines: [engine("edge", "Edge")],
    });
    // A new user starts with the page's voice
    await user.click(users.getByRole("button", { name: /en-US-AriaNeural/ }));
    await user.click(
      within(screen.getByRole("dialog")).getByTitle("en-US-GuyNeural"),
    );

    const settings = await saved();
    expect(settings.user_voices).toEqual([{ handle: "@alice", voice: guy }]);
    expect(settings.voice).toEqual(aria);

    await user.click(users.getByRole("button", { name: "Remove" }));
    expect(users.getByText("No special users yet.")).toBeInTheDocument();
    expect((await saved()).user_voices).toEqual([]);
  });

  it("changes the protection limits and the banned words", async () => {
    const { user } = await setup();

    fireEvent.change(field("Cooldown").getByRole("spinbutton"), {
      target: { value: "8" },
    });
    fireEvent.change(field("Max queue length").getByRole("spinbutton"), {
      target: { value: "3" },
    });
    fireEvent.change(field("Max message length").getByRole("spinbutton"), {
      target: { value: "99" },
    });
    const banned = screen.getByPlaceholderText("word1, word2, word3...");
    await user.clear(banned);
    await user.type(banned, "one, two ,, three");

    expect((await saved()).protection).toEqual({
      cooldown: 8,
      queue_length: 3,
      comment_length: 99,
      banned: ["one", "two", "three"],
    });
  });

  it("keeps the max comment length a whole number above 0", async () => {
    await setup();

    for (const value of ["0", "2.5"]) {
      fireEvent.change(field("Max message length").getByRole("spinbutton"), {
        target: { value },
      });
    }

    await wait(300);
    expect(sent(APP_EVENTS.UPDATE_TTS_SETTINGS)).toHaveLength(0);
  });

  it("changes who may use TTS", async () => {
    const { user } = await setup();
    const permissions = section("Permissions");
    // Hidden from screen readers until Minimum fan level is on
    const level = permissions.getByRole("spinbutton", { hidden: true });
    expect(level).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: "Allow everyone" }));
    await user.click(screen.getByRole("checkbox", { name: "Followers only" }));
    await user.click(screen.getByRole("checkbox", { name: "Moderators only" }));
    await user.click(
      screen.getByRole("checkbox", { name: "Minimum fan level" }),
    );
    expect(level).toBeEnabled();
    fireEvent.change(level, { target: { value: "10" } });

    expect(permissions.queryByText("Allow list")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("checkbox", { name: "Use allow and block lists" }),
    );
    await user.type(field("Allow list").getByRole("textbox"), "alice, bob");
    await user.type(field("Block list").getByRole("textbox"), "troll");

    expect((await saved()).permissions).toEqual({
      all: false,
      followers: true,
      superfans: false,
      moderators: true,
      level: { enabled: true, value: 10 },
      list: { enabled: true, white: ["alice", "bob"], black: ["troll"] },
    });
  });
});
