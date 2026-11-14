import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { engine, failure } from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { renderWithProviders } from "@test/render";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VoiceKeysSection } from "./VoiceKeysSection";

const tiktok = (key = "") => ({
  ...engine("Default", "TikTok", "voiceKeys.sessionId"),
  key,
});
const eleven = (key = "") => ({
  ...engine("ElevenLabs", "ElevenLabs", "voiceKeys.apiKey"),
  key,
});
const fish = (key = "") => ({
  ...engine("FishAudio", "Fish Audio", "voiceKeys.apiKey"),
  key,
});

const keys = (...engines: ReturnType<typeof tiktok>[]) =>
  send(APP_EVENTS_RESPONSE.GET_VOICE_KEYS, { success: true, engines });

// An engine's form, around its field
const form = (label: string) =>
  within(screen.getByText(label).closest("div")!.parentElement!);
const field = (placeholder: string) =>
  screen.queryByPlaceholderText(placeholder);
const addButton = () =>
  screen.queryByRole("button", { name: "Add a voice engine" });
const saves = () => sent(APP_EVENTS.SET_VOICE_KEY);

describe("VoiceKeysSection", () => {
  it("asks main for the engines that take a key", () => {
    renderWithProviders(<VoiceKeysSection />);

    expect(sent(APP_EVENTS.GET_VOICE_KEYS)).toHaveLength(1);
  });

  it("stays hidden until an engine takes a key", async () => {
    renderWithProviders(<VoiceKeysSection />);
    expect(
      screen.queryByRole("heading", { name: "Voice engines" }),
    ).not.toBeInTheDocument();

    await send(APP_EVENTS_RESPONSE.GET_VOICE_KEYS, failure());
    await keys();
    expect(
      screen.queryByRole("heading", { name: "Voice engines" }),
    ).not.toBeInTheDocument();

    await keys(tiktok());
    expect(
      screen.getByRole("heading", { name: "Voice engines" }),
    ).toBeInTheDocument();
  });

  it("shows TikTok's field, and the others' only with a saved key", async () => {
    renderWithProviders(<VoiceKeysSection />);

    await keys(tiktok(), eleven("saved-key"), fish());

    expect(
      form("TikTok voices").getByText("(Session ID, optional)"),
    ).toBeInTheDocument();
    expect(field("TikTok Session ID...")).toHaveValue("");
    expect(field("ElevenLabs API key...")).toHaveValue("saved-key");
    expect(field("Fish Audio API key...")).not.toBeInTheDocument();
    // TikTok's stays: only the others can be removed
    expect(
      screen.queryByRole("button", { name: "Remove the TikTok key" }),
    ).not.toBeInTheDocument();
  });

  it("adds an engine from the menu, its field focused", async () => {
    const { user } = renderWithProviders(<VoiceKeysSection />);
    await keys(tiktok(), eleven("saved-key"), fish());

    await user.click(addButton()!);
    const menu = screen.getByRole("menu", { name: "Add a voice engine" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Fish Audio"]);
    await user.click(
      within(menu).getByRole("menuitem", { name: "Fish Audio" }),
    );

    expect(field("Fish Audio API key...")).toHaveFocus();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    // Nothing left to add
    expect(addButton()).not.toBeInTheDocument();
    expect(saves()).toEqual([]);
  });

  it("keeps a field while its key is cleared to paste another", async () => {
    const { user } = renderWithProviders(<VoiceKeysSection />);
    await keys(tiktok(), eleven("saved-key"));

    await user.clear(field("ElevenLabs API key...")!);
    await waitFor(() =>
      expect(saves()).toEqual([{ engine: "ElevenLabs", key: "" }]),
    );
    await keys(tiktok(), eleven());

    expect(field("ElevenLabs API key...")).toHaveValue("");
  });

  it("removes an engine and its key, after a change still waiting", async () => {
    const { user } = renderWithProviders(<VoiceKeysSection />);
    await keys(tiktok(), eleven(), fish("saved-key"));

    await user.type(field("Fish Audio API key...")!, "x");
    await user.click(
      screen.getByRole("button", { name: "Remove the Fish Audio key" }),
    );

    expect(saves()).toEqual([
      { engine: "FishAudio", key: "saved-keyx" },
      { engine: "FishAudio", key: "" },
    ]);
    expect(field("Fish Audio API key...")).not.toBeInTheDocument();
    // The removing button left, so the focus goes to the menu's
    expect(addButton()).toHaveFocus();

    // Main's answer doesn't bring it back
    await keys(tiktok(), eleven(), fish());
    expect(field("Fish Audio API key...")).not.toBeInTheDocument();
  });

  it("saves an engine's key as it's typed, with no Save button", async () => {
    const { user } = renderWithProviders(<VoiceKeysSection />);
    await keys(tiktok(), eleven("saved-key"));

    await user.type(field("TikTok Session ID...")!, "abc");

    await waitFor(() =>
      expect(saves().at(-1)).toEqual({ engine: "Default", key: "abc" }),
    );
    expect(saves().every(({ engine }) => engine === "Default")).toBe(true);
    expect(
      screen.queryByRole("button", { name: "Save" }),
    ).not.toBeInTheDocument();
  });

  it("replaces the typed key when main holds another one", async () => {
    const { user } = renderWithProviders(<VoiceKeysSection />);
    await keys(tiktok());
    const input = field("TikTok Session ID...")!;
    await user.type(input, "abc");

    await keys(tiktok("abc"));
    expect(input).toHaveValue("abc");

    await keys(tiktok("from-main"));
    expect(input).toHaveValue("from-main");
  });
});
