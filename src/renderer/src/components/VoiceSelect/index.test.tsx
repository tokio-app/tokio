import { APP_EVENTS, APP_EVENTS_RESPONSE, VoiceData } from "@/common/types";
import { voiceSample } from "@/helper/voices";
import { engine, failure, voice } from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { renderWithProviders } from "@test/render";
import { act, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VoiceSelect } from ".";

const ENGINES = [
  engine("edge", "Edge"),
  engine("windows", "Windows"),
  engine("tiktok", "TikTok", "Session ID"),
];

const VOICES = [
  voice("Zed", "es-MX"),
  voice("Ana", "es-MX", "windows"),
  voice("Bob", "en-US"),
  voice("Aria", "en-US"),
  voice("Amy", "en-GB"),
];
const NAMES = VOICES.map((v) => v.name);

const FILTERS = { speed: 1.2, pitch: 0.8 };
const data = new Uint8Array([1, 2, 3]);

function setup(value = voice("Aria")) {
  const onChange = vi.fn();
  const view = renderWithProviders(
    <VoiceSelect value={value} filters={FILTERS} onChange={onChange} />,
  );
  // The field is the only thing rendered in place, the picker is portaled
  const field = within(view.container).getByRole("button");
  return { ...view, onChange, field, queue: view.audio.queue("voice-preview") };
}

const voicesLoaded = (voices: VoiceData[] = VOICES) =>
  send(APP_EVENTS_RESPONSE.GET_VOICES, {
    success: true,
    voices,
    engines: ENGINES,
  });

const dialog = () => screen.queryByRole("dialog");
const picker = () => within(screen.getByRole("dialog"));

// Voice names in the picker's list, in order
const listed = () =>
  picker()
    .queryAllByRole("button")
    .map((button) => button.title)
    .filter((title) => NAMES.includes(title));

// A row of the picker, by its voice's name
const row = (name: string) => within(picker().getByTitle(name).parentElement!);

// A Select's options are portaled to the body, outside the picker
const option = (text: string) =>
  screen.getAllByText(text).find((el) => !dialog()?.contains(el))!;

const previewId = (v: VoiceData) =>
  `voice-preview:${v.engine}|${v.lang}|${v.name}`;

const previewed = (v: VoiceData, reply: object = { success: true, data }) =>
  send(APP_EVENTS_RESPONSE.GET_TTS_TEST, {
    success: true,
    id: previewId(v),
    ...reply,
  });

async function openPicker() {
  const view = setup();
  await voicesLoaded();
  await view.user.click(view.field);
  return view;
}

describe("VoiceSelect", () => {
  it("shows the voice, with its engine once the voices load", async () => {
    const { field } = setup();
    expect(sent(APP_EVENTS.GET_VOICES)).toHaveLength(1);
    expect(field).toHaveAttribute("title", "Aria");
    expect(field).toHaveTextContent("AriaEnglish (United States)");
    expect(field).not.toHaveTextContent("Edge");

    await voicesLoaded();

    expect(field).toHaveTextContent("English (United States) · Edge");
  });

  it("ignores a failed voice list", async () => {
    const { user, field } = setup();

    await send(APP_EVENTS_RESPONSE.GET_VOICES, failure());
    await user.click(field);

    expect(picker().getByText("No voices available.")).toBeInTheDocument();
  });

  it("opens the picker over everything else", async () => {
    const { user, field, container } = setup();
    expect(dialog()).not.toBeInTheDocument();

    await user.click(field);

    expect(
      picker().getByRole("heading", { name: "Select a voice" }),
    ).toBeInTheDocument();
    expect(container).not.toContainElement(dialog());
    expect(picker().getByPlaceholderText("Search voices...")).toHaveFocus();
  });

  it("picks a voice and closes", async () => {
    const { user, onChange } = await openPicker();

    await user.click(picker().getByTitle("Bob"));

    expect(onChange).toHaveBeenCalledWith(voice("Bob", "en-US"));
    expect(dialog()).not.toBeInTheDocument();
  });

  it("closes with Cancel without picking", async () => {
    const { user, onChange } = await openPicker();

    await user.click(picker().getByRole("button", { name: "Cancel" }));

    expect(dialog()).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("lists the voices by language and engine, then name", async () => {
    await openPicker();

    expect(listed()).toEqual(["Amy", "Aria", "Bob", "Zed", "Ana"]);
    expect(row("Ana").getByText("Spanish (Mexico) · Windows")).toBeVisible();
  });

  it("searches names, languages and engines", async () => {
    const { user } = await openPicker();
    const search = picker().getByPlaceholderText("Search voices...");

    await user.type(search, "  BO ");
    expect(listed()).toEqual(["Bob"]);

    await user.clear(search);
    await user.type(search, "spanish");
    expect(listed()).toEqual(["Zed", "Ana"]);

    await user.clear(search);
    await user.type(search, "windows");
    expect(listed()).toEqual(["Ana"]);

    await user.clear(search);
    await user.type(search, "zzz");
    expect(listed()).toEqual([]);
    expect(picker().getByText("No voices match.")).toBeInTheDocument();
  });

  it("narrows the list to an engine", async () => {
    const { user } = await openPicker();

    await user.click(picker().getByText("All engines"));
    // Only engines with voices are offered
    expect(screen.queryByText("TikTok")).not.toBeInTheDocument();
    await user.click(option("Windows"));

    expect(listed()).toEqual(["Ana"]);
  });

  it("narrows the list to a language", async () => {
    const { user } = await openPicker();

    await user.click(picker().getByText("All languages"));
    await user.click(option("English"));

    expect(listed()).toEqual(["Amy", "Aria", "Bob"]);
  });

  it("says when there are no voices", async () => {
    const { user, field } = setup();

    await user.click(field);

    expect(picker().getByText("No voices available.")).toBeInTheDocument();
  });

  describe("previews", () => {
    it("speaks a sample with the voice, loading until it plays", async () => {
      const { user, queue } = await openPicker();
      const bob = voice("Bob", "en-US");

      await user.click(row("Bob").getByRole("button", { name: "Play" }));

      expect(sent(APP_EVENTS.GET_TTS_TEST)).toEqual([
        { id: previewId(bob), text: voiceSample("en-US"), voice: bob },
      ]);
      expect(row("Bob").getByRole("button", { name: "Cancel" })).toBeVisible();

      await previewed(bob);

      expect(queue.enqueue).toHaveBeenCalledWith(data, {
        speed: 1.2,
        pitch: 0.8,
        onEnded: expect.any(Function),
      });
      expect(row("Bob").getByRole("button", { name: "Stop" })).toBeVisible();
    });

    it("ends when the sample ends", async () => {
      const { user, queue } = await openPicker();
      await user.click(row("Bob").getByRole("button", { name: "Play" }));
      await previewed(voice("Bob", "en-US"));

      const [, options] = queue.enqueue.mock.calls[0];
      act(() => options?.onEnded?.());

      expect(row("Bob").getByRole("button", { name: "Play" })).toBeVisible();
    });

    it("ends when the sample fails or can't be queued", async () => {
      const { user, queue } = await openPicker();

      await user.click(row("Bob").getByRole("button", { name: "Play" }));
      await previewed(voice("Bob", "en-US"), failure());
      expect(row("Bob").getByRole("button", { name: "Play" })).toBeVisible();
      expect(queue.enqueue).not.toHaveBeenCalled();

      queue.enqueue.mockResolvedValueOnce(false);
      await user.click(row("Amy").getByRole("button", { name: "Play" }));
      await previewed(voice("Amy", "en-GB"));
      expect(row("Amy").getByRole("button", { name: "Play" })).toBeVisible();
    });

    it("ignores samples it didn't ask for", async () => {
      const { user, queue } = await openPicker();
      await user.click(row("Bob").getByRole("button", { name: "Play" }));

      // The TTS page's tester, and a preview of another voice
      await send(APP_EVENTS_RESPONSE.GET_TTS_TEST, {
        success: true,
        id: "tts-test",
        data,
      });
      await previewed(voice("Aria", "en-US"));

      expect(queue.enqueue).not.toHaveBeenCalled();
      expect(row("Bob").getByRole("button", { name: "Cancel" })).toBeVisible();
    });

    it("replaces a preview that's still loading", async () => {
      const { user, queue } = await openPicker();

      await user.click(row("Bob").getByRole("button", { name: "Play" }));
      await user.click(row("Amy").getByRole("button", { name: "Play" }));
      await previewed(voice("Bob", "en-US"));

      expect(queue.enqueue).not.toHaveBeenCalled();
      expect(row("Bob").getByRole("button", { name: "Play" })).toBeVisible();
      expect(row("Amy").getByRole("button", { name: "Cancel" })).toBeVisible();

      await previewed(voice("Amy", "en-GB"));
      expect(queue.enqueue).toHaveBeenCalledOnce();
    });

    it("stops the voice playing when it's played again", async () => {
      const { user, queue } = await openPicker();
      await user.click(row("Bob").getByRole("button", { name: "Play" }));
      await previewed(voice("Bob", "en-US"));
      queue.stop.mockClear();

      await user.click(row("Bob").getByRole("button", { name: "Stop" }));

      expect(queue.stop).toHaveBeenCalled();
      expect(row("Bob").getByRole("button", { name: "Play" })).toBeVisible();
      expect(sent(APP_EVENTS.GET_TTS_TEST)).toHaveLength(1);
    });

    it("cancels a preview that's loading", async () => {
      const { user, queue } = await openPicker();
      await user.click(row("Bob").getByRole("button", { name: "Play" }));

      await user.click(row("Bob").getByRole("button", { name: "Cancel" }));
      await previewed(voice("Bob", "en-US"));

      expect(queue.enqueue).not.toHaveBeenCalled();
      expect(row("Bob").getByRole("button", { name: "Play" })).toBeVisible();
    });

    it("stops when the picker closes", async () => {
      const { user, queue } = await openPicker();
      await user.click(row("Bob").getByRole("button", { name: "Play" }));
      await previewed(voice("Bob", "en-US"));
      queue.stop.mockClear();

      await user.click(picker().getByRole("button", { name: "Cancel" }));

      expect(queue.stop).toHaveBeenCalled();
    });
  });
});
