import { Alert, AlertSound, AlertTts } from "@/common/schemas";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  AlertTrigger,
  TOKIO_EVENTS,
} from "@/common/types";
import { ALERT_MESSAGE_VARIABLES } from "@/common/util";
import { createAlert } from "@/pages/Alerts/helper";
import { alertSound, engine, failure, voice } from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { renderWithProviders } from "@test/render";
import { fireEvent, screen, within } from "@testing-library/react";
import { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { SoundPicker } from ".";
import styles from "./soundpicker.module.css";

const DEFAULTS = { voice: voice("Aria"), speed: 1, pitch: 1 };

const LIBRARY = [
  alertSound("Airhorn"),
  alertSound("Bell"),
  alertSound("Big Bell"),
];

function alert(patch: Partial<Alert> = {}, type?: AlertTrigger): Alert {
  const base = createAlert();
  return {
    ...base,
    id: "alert-1",
    ...patch,
    trigger: { ...base.trigger, type: type ?? base.trigger.type },
  };
}

const tts = (message: string): AlertTts => ({
  voice: voice("Guy"),
  message,
  speed: 1.5,
  pitch: 0.8,
});

function setup(
  item = alert(),
  props: Partial<ComponentProps<typeof SoundPicker>> = {},
) {
  const handlers = {
    onTest: vi.fn(),
    onRequest: vi.fn(),
    onSelect: vi.fn(),
    onSelectTts: vi.fn(),
    onClear: vi.fn(),
    onClose: vi.fn(),
  };
  const view = renderWithProviders(
    <SoundPicker
      alert={item}
      ttsDefaults={DEFAULTS}
      testing={null}
      {...handlers}
      {...props}
    />,
  );
  return { ...view, ...handlers };
}

const sounds = (data: AlertSound[]) =>
  send(APP_EVENTS_RESPONSE.GET_SOUNDS, { success: true, data });

const selectedTab = () =>
  screen
    .getAllByRole("tab")
    .filter((tab) => tab.getAttribute("aria-selected") === "true")
    .map((tab) => tab.textContent);

const title = () => screen.getByRole("heading").textContent;

const message = () =>
  screen.getByPlaceholderText("Type what the alert says...");

// The library row of a sound, by its name
const row = (name: string) =>
  within(screen.getByRole("button", { name }).parentElement!);

const listed = () =>
  LIBRARY.map((s) => s.name).filter(
    (name) => screen.queryByRole("button", { name }) !== null,
  );

describe("SoundPicker", () => {
  it("asks main for the sound library", () => {
    setup();

    expect(sent(APP_EVENTS.GET_SOUNDS)).toHaveLength(1);
  });

  it("opens on your sounds once they load, if you have any", async () => {
    setup();
    expect(selectedTab()).toEqual([]);

    await sounds(LIBRARY);

    expect(selectedTab()).toEqual(["My sounds"]);
    expect(listed()).toEqual(["Airhorn", "Bell", "Big Bell"]);
  });

  it("opens on MyInstants when you have no sounds", async () => {
    setup();

    await sounds([]);

    expect(selectedTab()).toEqual(["MyInstants"]);
    // The tab stays mounted, hidden only by its class
    const search = screen.getByPlaceholderText("Search sounds... (Enter)");
    expect(search.closest("form")?.parentElement).not.toHaveClass(
      styles.hidden,
    );
  });

  it("opens on the message of an alert that speaks", async () => {
    setup(alert({ tts: tts("Thanks for the follow") }));
    expect(selectedTab()).toEqual(["Text-to-speech"]);
    expect(message()).toHaveValue("Thanks for the follow");

    await sounds(LIBRARY);

    expect(selectedTab()).toEqual(["Text-to-speech"]);
  });

  it("asks to speak a message on the text-to-speech tab", async () => {
    const { user } = setup();
    await sounds(LIBRARY);
    expect(title()).toBe("Select a sound");
    expect(
      screen.getByText(
        "Pick one of your sounds, search MyInstants, or use a file from your computer.",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Text-to-speech" }));

    expect(title()).toBe("Speak a message");
    expect(
      screen.getByText(
        "The alert says this with text-to-speech instead of playing a sound.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Browse file..." }),
    ).not.toBeInTheDocument();
  });

  it("clears the alert's sound or message, when it has one", async () => {
    const { user, onClear, unmount } = setup();
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
    unmount();

    const withSound = setup(alert({ sound: LIBRARY[0] }));
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(withSound.onClear).toHaveBeenCalledOnce();
    expect(onClear).not.toHaveBeenCalled();
    expect(sent(APP_EVENTS.REMOVE_SOUND)).toEqual([]);
  });

  it("marks the alert's sound in your sounds", async () => {
    setup(alert({ sound: LIBRARY[1] }));
    await sounds(LIBRARY);

    expect(screen.getByRole("button", { current: true })).toHaveTextContent(
      "Bell",
    );
  });

  it("browses for a file for the alert", async () => {
    const { user, onRequest } = setup();

    await user.click(screen.getByRole("button", { name: "Browse file..." }));

    expect(sent(APP_EVENTS.IMPORT_SOUND)).toEqual([{ id: "alert-1" }]);
    expect(onRequest).toHaveBeenCalledOnce();
  });

  it("loads MyInstants only once its tab is first shown", async () => {
    const { user } = setup();
    await sounds(LIBRARY);
    expect(sent(APP_EVENTS.SEARCH_SOUNDS)).toEqual([]);

    await user.click(screen.getByRole("tab", { name: "MyInstants" }));
    await user.click(screen.getByRole("tab", { name: "My sounds" }));
    await user.click(screen.getByRole("tab", { name: "MyInstants" }));

    expect(sent(APP_EVENTS.SEARCH_SOUNDS)).toEqual([{ query: "", page: 1 }]);
  });

  it("closes with Cancel, on any tab", async () => {
    const { user, onClose } = setup();
    await sounds(LIBRARY);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("tab", { name: "Text-to-speech" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("uses a message with the default voice, speed and pitch", async () => {
    const { user, onSelectTts } = setup();
    await user.click(screen.getByRole("tab", { name: "Text-to-speech" }));
    const use = screen.getByRole("button", { name: "Use text-to-speech" });
    expect(message()).toHaveValue("");
    expect(use).toBeDisabled();

    await user.type(message(), "   ");
    expect(use).toBeDisabled();

    await user.clear(message());
    await user.type(message(), "Thanks for the follow");
    await user.click(use);

    expect(onSelectTts).toHaveBeenCalledWith({
      ...DEFAULTS,
      message: "Thanks for the follow",
    });
  });

  it("uses the message with the voice, speed and pitch picked", async () => {
    const { user, onSelectTts } = setup(alert({ tts: tts("Hello") }));
    await send(APP_EVENTS_RESPONSE.GET_VOICES, {
      success: true,
      voices: [voice("Guy"), voice("Jenny")],
      engines: [engine("edge", "Edge")],
    });

    const [speed, pitch] = screen.getAllByRole("slider");
    fireEvent.change(speed, { target: { value: "1.8" } });
    fireEvent.change(pitch, { target: { value: "1.2" } });
    expect(screen.getByText("Speed (1.8x)")).toBeInTheDocument();
    expect(screen.getByText("Pitch (1.2)")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Guy/ }));
    await user.click(screen.getByTitle("Jenny"));
    await user.click(
      screen.getByRole("button", { name: "Use text-to-speech" }),
    );

    expect(onSelectTts).toHaveBeenCalledWith({
      voice: voice("Jenny"),
      message: "Hello",
      speed: 1.8,
      pitch: 1.2,
    });
  });

  it("says when a sound for this alert couldn't be saved", async () => {
    setup();

    await send(APP_EVENTS_RESPONSE.SET_ALERT_SOUND, {
      ...failure(),
      id: "alert-2",
    });
    expect(
      screen.queryByText("Couldn't save that sound."),
    ).not.toBeInTheDocument();

    await send(APP_EVENTS_RESPONSE.SET_ALERT_SOUND, {
      ...failure(),
      id: "alert-1",
    });
    expect(screen.getByText("Couldn't save that sound.")).toBeInTheDocument();

    await send(APP_EVENTS_RESPONSE.SET_ALERT_SOUND, {
      success: true,
      id: "alert-1",
      sound: alertSound("Airhorn"),
    });
    expect(
      screen.queryByText("Couldn't save that sound."),
    ).not.toBeInTheDocument();
  });

  describe("your sounds", () => {
    it("filters them by name", async () => {
      const { user } = setup();
      await sounds(LIBRARY);

      await user.type(
        screen.getByPlaceholderText("Filter your sounds..."),
        "BELL ",
      );

      expect(listed()).toEqual(["Bell", "Big Bell"]);
    });

    it("says when there are none, or none match", async () => {
      const { user } = setup();
      await sounds([]);
      await user.click(screen.getByRole("tab", { name: "My sounds" }));

      expect(
        screen.getByText(
          "No sounds yet. Download one from MyInstants, upload them in Settings, or browse for a file.",
        ),
      ).toBeInTheDocument();

      await sounds(LIBRARY);
      await user.type(
        screen.getByPlaceholderText("Filter your sounds..."),
        "zzz",
      );

      expect(screen.getByText("No sounds match.")).toBeInTheDocument();
    });

    it("picks one", async () => {
      const { user, onSelect } = setup();
      await sounds(LIBRARY);

      await user.click(screen.getByRole("button", { name: "Bell" }));

      expect(onSelect).toHaveBeenCalledWith(alertSound("Bell"));
    });

    it("plays one at the preview volume", async () => {
      const { user, onTest } = setup();
      await sounds(LIBRARY);

      await user.click(row("Bell").getByRole("button", { name: "Play" }));

      expect(onTest).toHaveBeenCalledWith({
        id: "bell.mp3",
        file: "bell.mp3",
        volume: 100,
      });
    });

    it("shows the one being tested", async () => {
      setup(alert(), { testing: { id: "bell.mp3", loading: false } });
      await sounds(LIBRARY);

      expect(row("Bell").getByRole("button", { name: "Stop" })).toBeVisible();
      expect(
        row("Airhorn").getByRole("button", { name: "Play" }),
      ).toBeVisible();
    });

    it("deletes one once you confirm", async () => {
      const { user, onTest } = setup();
      await sounds(LIBRARY);

      await user.click(row("Bell").getByRole("button", { name: "Delete" }));
      const confirm = screen.getByRole("dialog", { name: "Delete sound?" });
      expect(confirm).toHaveTextContent(
        '"Bell" will be deleted from your computer and from every alert that plays it, in all your profiles.',
      );
      expect(sent(APP_EVENTS.REMOVE_SOUND)).toEqual([]);

      await user.click(within(confirm).getByRole("button", { name: "Delete" }));

      expect(sent(APP_EVENTS.REMOVE_SOUND)).toEqual([{ file: "bell.mp3" }]);
      expect(onTest).not.toHaveBeenCalled();
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
    });

    it("keeps one when you cancel", async () => {
      const { user } = setup();
      await sounds(LIBRARY);

      await user.click(row("Bell").getByRole("button", { name: "Delete" }));
      await user.click(
        within(screen.getByRole("dialog", { name: "Delete sound?" })).getByRole(
          "button",
          { name: "Cancel" },
        ),
      );

      expect(sent(APP_EVENTS.REMOVE_SOUND)).toEqual([]);
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
    });

    it("stops the test of a sound before removing it", async () => {
      const { user, onTest } = setup(alert(), {
        testing: { id: "bell.mp3", loading: false },
      });
      await sounds(LIBRARY);

      await user.click(row("Bell").getByRole("button", { name: "Delete" }));
      await user.click(
        within(screen.getByRole("dialog", { name: "Delete sound?" })).getByRole(
          "button",
          { name: "Delete" },
        ),
      );

      expect(onTest).toHaveBeenCalledWith({
        id: "bell.mp3",
        file: "bell.mp3",
        volume: 100,
      });
      const emit = vi.mocked(window.api.emit);
      const removed = emit.mock.calls.findIndex(
        ([event]) => event === APP_EVENTS.REMOVE_SOUND,
      );
      expect(onTest.mock.invocationCallOrder[0]).toBeLessThan(
        emit.mock.invocationCallOrder[removed],
      );
    });
  });

  describe("text-to-speech", () => {
    async function openTts(item = alert()) {
      const view = setup(item);
      await view.user.click(
        screen.getByRole("tab", { name: "Text-to-speech" }),
      );
      return view;
    }

    it("tests the message, once there is one", async () => {
      const { user, onTest } = await openTts(alert({}, TOKIO_EVENTS.GIFT));
      const play = screen.getByRole("button", { name: "Play" });
      expect(play).toBeDisabled();

      await user.type(message(), "Thanks for the gift");
      await user.click(play);

      expect(onTest).toHaveBeenCalledWith({
        id: "alert-1:tts",
        tts: { ...DEFAULTS, message: "Thanks for the gift" },
        trigger: TOKIO_EVENTS.GIFT,
        volume: 100,
      });
    });

    it("shows its test loading", async () => {
      setup(alert({ tts: tts("Hello") }), {
        testing: { id: "alert-1:tts", loading: true },
      });

      // The play button cancels a test that's loading
      expect(screen.getByTitle("Cancel")).toBeEnabled();
      expect(screen.queryByTitle("Play")).not.toBeInTheDocument();
    });

    it("lists the trigger's variables and puts them in the message", async () => {
      const { user } = await openTts(alert({}, TOKIO_EVENTS.GIFT));

      const variables = ALERT_MESSAGE_VARIABLES[TOKIO_EVENTS.GIFT].map((name) =>
        screen.getByRole("button", { name: `{${name}}` }),
      );
      expect(variables).toHaveLength(4);

      await user.type(message(), "Thanks ");
      await user.click(screen.getByRole("button", { name: "{username}" }));

      expect(message()).toHaveValue("Thanks {username}");
    });

    it("has no count for a gift alert on every gift", async () => {
      const base = alert({}, TOKIO_EVENTS.GIFT);
      await openTts({
        ...base,
        trigger: { ...base.trigger, every_gift: true },
      });

      for (const name of ["username", "handle", "gift"]) {
        expect(
          screen.getByRole("button", { name: `{${name}}` }),
        ).toBeInTheDocument();
      }
      expect(
        screen.queryByRole("button", { name: "{count}" }),
      ).not.toBeInTheDocument();
    });

    it("says when the trigger has no variables", async () => {
      await openTts(alert({}, TOKIO_EVENTS.ENVELOPE));

      expect(
        screen.getByText("This event has no variables."),
      ).toBeInTheDocument();
    });

    it("shows the speed and pitch", async () => {
      await openTts();

      const [speed, pitch] = screen.getAllByRole("slider");
      expect(speed).toHaveValue("1");
      expect(pitch).toHaveValue("1");
      expect(screen.getByText("Speed (1x)")).toBeInTheDocument();
      expect(screen.getByText("Pitch (1)")).toBeInTheDocument();
    });

    it("shows the voice, with its details once the voices load", async () => {
      await openTts();
      expect(sent(APP_EVENTS.GET_VOICES)).toHaveLength(1);
      expect(screen.getByTitle("Aria")).toHaveTextContent(
        "AriaEnglish (United States)",
      );

      await send(APP_EVENTS_RESPONSE.GET_VOICES, {
        success: true,
        voices: [voice("Aria")],
        engines: [engine("edge", "Edge")],
      });

      expect(screen.getByTitle("Aria")).toHaveTextContent(
        "English (United States) · Edge",
      );
    });
  });
});
