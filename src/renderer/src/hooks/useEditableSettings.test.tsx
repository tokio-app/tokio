import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { defaultProfile } from "@/common/util";
import { failure, profileReply } from "@test/fixtures";
import { listeners, send, sent } from "@test/ipc";
import { providers } from "@test/render";
import { act, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useEditableSettings } from "./useEditableSettings";
import { useUnsavedChanges } from "./useUnsavedChanges";

// The TTS settings, and the guard the page's navigation goes through
function setup(onLoad?: () => void) {
  const { wrapper } = providers();
  return renderHook(
    () => ({
      settings: useEditableSettings("tts", "TTS", onLoad),
      unsaved: useUnsavedChanges(),
    }),
    { wrapper },
  );
}

const loaded = profileReply((p) => {
  p.tts.filters.speed = 1.5;
});

describe("useEditableSettings", () => {
  it("starts from the defaults and asks main for the profile", () => {
    const { result } = setup();

    expect(result.current.settings.draft).toEqual(defaultProfile.tts);
    expect(result.current.settings.hasChanges).toBe(false);
    expect(sent(APP_EVENTS.GET_PROFILE)).toHaveLength(1);
  });

  it("loads its section of the profile", async () => {
    const onLoad = vi.fn();
    const { result } = setup(onLoad);

    await send(APP_EVENTS_RESPONSE.GET_PROFILE, loaded);

    expect(result.current.settings.draft).toEqual(loaded.profile.tts);
    expect(result.current.settings.hasChanges).toBe(false);
    expect(onLoad).toHaveBeenCalledWith(loaded.profile.tts);
  });

  it("ignores a failed profile reply", async () => {
    const onLoad = vi.fn();
    const { result } = setup(onLoad);

    await send(APP_EVENTS_RESPONSE.GET_PROFILE, failure());

    expect(result.current.settings.draft).toEqual(defaultProfile.tts);
    expect(onLoad).not.toHaveBeenCalled();
  });

  it("has changes after an edit, until they're saved", async () => {
    const { result } = setup();
    await send(APP_EVENTS_RESPONSE.GET_PROFILE, loaded);

    act(() =>
      result.current.settings.update((s) => {
        s.filters.pitch = 2;
      }),
    );
    expect(result.current.settings.hasChanges).toBe(true);

    let saved!: Promise<boolean>;
    act(() => {
      saved = result.current.settings.save();
    });
    expect(sent(APP_EVENTS.UPDATE_TTS_SETTINGS)).toEqual([
      { settings: result.current.settings.draft },
    ]);

    await send(APP_EVENTS_RESPONSE.UPDATE_TTS_SETTINGS, { success: true });

    expect(await saved).toBe(true);
    expect(result.current.settings.hasChanges).toBe(false);
    // The reply's listener only waited for this save
    expect(listeners(APP_EVENTS_RESPONSE.UPDATE_TTS_SETTINGS)).toBe(0);
  });

  it("keeps the changes when saving fails", async () => {
    const { result } = setup();
    act(() =>
      result.current.settings.update((s) => {
        s.filters.pitch = 2;
      }),
    );

    let saved!: Promise<boolean>;
    act(() => {
      saved = result.current.settings.save();
    });
    await send(APP_EVENTS_RESPONSE.UPDATE_TTS_SETTINGS, failure());

    expect(await saved).toBe(false);
    expect(result.current.settings.hasChanges).toBe(true);
  });

  it("saves the music settings with the music event", async () => {
    const { wrapper } = providers();
    const { result } = renderHook(() => useEditableSettings("music", "Music"), {
      wrapper,
    });

    act(() => {
      void result.current.save();
    });

    expect(sent(APP_EVENTS.UPDATE_MUSIC_SETTINGS)).toEqual([
      { settings: defaultProfile.music },
    ]);
  });

  it("asks before its changes are lost, and discarding brings back the saved ones", async () => {
    const user = userEvent.setup();
    const { result } = setup();
    await send(APP_EVENTS_RESPONSE.GET_PROFILE, loaded);
    act(() =>
      result.current.settings.update((s) => {
        s.filters.pitch = 2;
      }),
    );

    let proceed!: Promise<boolean>;
    act(() => {
      proceed = result.current.unsaved.confirmDiscard();
    });
    expect(
      screen.getByText(
        "You have unsaved TTS settings. Save them before continuing?",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Discard" }));

    expect(await proceed).toBe(true);
    expect(result.current.settings.draft).toEqual(loaded.profile.tts);
    expect(result.current.settings.hasChanges).toBe(false);
  });

  it("saves from the prompt before going on", async () => {
    const user = userEvent.setup();
    const { result } = setup();
    act(() =>
      result.current.settings.update((s) => {
        s.filters.pitch = 2;
      }),
    );

    let proceed!: Promise<boolean>;
    act(() => {
      proceed = result.current.unsaved.confirmDiscard();
    });
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(sent(APP_EVENTS.UPDATE_TTS_SETTINGS)).toHaveLength(1);

    await send(APP_EVENTS_RESPONSE.UPDATE_TTS_SETTINGS, { success: true });

    expect(await proceed).toBe(true);
    expect(result.current.settings.hasChanges).toBe(false);
  });
});
