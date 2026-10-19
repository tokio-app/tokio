import { Profile } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { defaultProfile } from "@/common/util";
import { failure, profileReply } from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { providers } from "@test/render";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditableSettings } from "./useEditableSettings";

// The TTS settings, as the TTS page edits them
function setup(onLoad?: (profile: Profile) => void) {
  const { wrapper } = providers();
  const hook = renderHook(() => useEditableSettings("tts", onLoad), {
    wrapper,
  });
  // A quick change, like a slider's
  const setPitch = (pitch: number) =>
    act(() =>
      hook.result.current.update((s) => {
        s.filters.pitch = pitch;
      }),
    );
  return { ...hook, setPitch };
}

const loaded = profileReply((p) => {
  p.tts.filters.speed = 1.5;
});

const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const saves = () =>
  sent(APP_EVENTS.UPDATE_TTS_SETTINGS).map(({ settings }) => settings);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useEditableSettings", () => {
  it("starts from the defaults and asks main for the profile", () => {
    const { result } = setup();

    expect(result.current.settings).toEqual(defaultProfile.tts);
    expect(sent(APP_EVENTS.GET_PROFILE)).toHaveLength(1);
  });

  it("loads its section of the profile", async () => {
    const onLoad = vi.fn();
    const { result } = setup(onLoad);

    await send(APP_EVENTS_RESPONSE.GET_PROFILE, loaded);

    expect(result.current.settings).toEqual(loaded.profile.tts);
    expect(onLoad).toHaveBeenCalledWith(loaded.profile);
  });

  it("ignores a failed profile reply", async () => {
    const onLoad = vi.fn();
    const { result } = setup(onLoad);

    await send(APP_EVENTS_RESPONSE.GET_PROFILE, failure());

    expect(result.current.settings).toEqual(defaultProfile.tts);
    expect(onLoad).not.toHaveBeenCalled();
  });

  it("doesn't save the profile it just loaded", async () => {
    const { unmount } = setup();
    await send(APP_EVENTS_RESPONSE.GET_PROFILE, loaded);

    await wait(1000);
    unmount();

    expect(saves()).toEqual([]);
  });

  it("saves 300ms after a change", async () => {
    const { setPitch } = setup();
    await send(APP_EVENTS_RESPONSE.GET_PROFILE, loaded);

    setPitch(2);
    await wait(299);
    expect(saves()).toEqual([]);

    await wait(1);
    expect(saves()).toEqual([
      {
        ...loaded.profile.tts,
        filters: { ...loaded.profile.tts.filters, pitch: 2 },
      },
    ]);
  });

  it("saves quick changes together", async () => {
    const { setPitch } = setup();
    await send(APP_EVENTS_RESPONSE.GET_PROFILE, loaded);

    setPitch(2);
    await wait(200);
    setPitch(1.2);
    await wait(299);
    expect(saves()).toEqual([]);

    await wait(1);
    expect(saves().map((s) => s.filters.pitch)).toEqual([1.2]);
  });

  it("sends a change still waiting when the page closes", async () => {
    const { setPitch, unmount } = setup();
    await send(APP_EVENTS_RESPONSE.GET_PROFILE, loaded);
    setPitch(2);

    unmount();

    expect(saves().map((s) => s.filters.pitch)).toEqual([2]);
  });

  it("doesn't send a change twice when the page closes", async () => {
    const { setPitch, unmount } = setup();
    await send(APP_EVENTS_RESPONSE.GET_PROFILE, loaded);
    setPitch(2);
    await wait(300);

    unmount();

    expect(saves()).toHaveLength(1);
  });

  // Like a checkbox clicked twice
  it("doesn't send a change undone before it was saved", async () => {
    const { setPitch, unmount } = setup();
    await send(APP_EVENTS_RESPONSE.GET_PROFILE, loaded);

    setPitch(2);
    setPitch(loaded.profile.tts.filters.pitch);
    await wait(300);
    unmount();

    expect(saves()).toEqual([]);
  });

  // Sending it on leaving would write it into the new profile
  it("drops a change still waiting when another profile loads", async () => {
    const { setPitch, unmount } = setup();
    await send(APP_EVENTS_RESPONSE.GET_PROFILE, loaded);
    setPitch(2);

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
    setup();

    await send(APP_EVENTS_RESPONSE.UPDATE_TTS_SETTINGS, { success: true });
    expect(sent(APP_EVENTS.GET_PROFILE)).toHaveLength(1);

    await send(APP_EVENTS_RESPONSE.UPDATE_TTS_SETTINGS, failure());
    expect(sent(APP_EVENTS.GET_PROFILE)).toHaveLength(2);
  });

  it("saves the music and alerts settings with their events", async () => {
    const { wrapper } = providers();
    const { result } = renderHook(
      () => ({
        music: useEditableSettings("music"),
        alerts: useEditableSettings("alerts"),
      }),
      { wrapper },
    );
    await send(APP_EVENTS_RESPONSE.GET_PROFILE, loaded);

    act(() => {
      result.current.music.update((s) => {
        s.protection.cooldown = 9;
      });
      result.current.alerts.update((s) => {
        s.queue_length = 5;
      });
    });
    await wait(300);

    expect(sent(APP_EVENTS.UPDATE_MUSIC_SETTINGS)).toEqual([
      {
        settings: {
          ...loaded.profile.music,
          protection: { ...loaded.profile.music.protection, cooldown: 9 },
        },
      },
    ]);
    expect(sent(APP_EVENTS.UPDATE_ALERTS_SETTINGS)).toEqual([
      { settings: { ...loaded.profile.alerts, queue_length: 5 } },
    ]);
    expect(saves()).toEqual([]);
  });
});
