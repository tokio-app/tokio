import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { engine, failure } from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { renderWithProviders } from "@test/render";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VoiceKeysSection } from "./VoiceKeysSection";

const azure = (key = "") => ({ ...engine("azure", "Azure", "API key"), key });
const eleven = (key = "") => ({
  ...engine("elevenlabs", "ElevenLabs", "API key"),
  key,
});

const keys = (...engines: ReturnType<typeof azure>[]) =>
  send(APP_EVENTS_RESPONSE.GET_VOICE_KEYS, { success: true, engines });

// An engine's form: its field and the Save button next to it
const form = (label: string) =>
  within(screen.getByText(label).closest("div")!.parentElement!);

describe("VoiceKeysSection", () => {
  it("asks main for the engines that take a key", () => {
    renderWithProviders(<VoiceKeysSection />);

    expect(sent(APP_EVENTS.GET_VOICE_KEYS)).toHaveLength(1);
  });

  it("stays hidden until an engine takes a key", async () => {
    renderWithProviders(<VoiceKeysSection />);
    expect(
      screen.queryByRole("heading", { name: "Voice Engines" }),
    ).not.toBeInTheDocument();

    await send(APP_EVENTS_RESPONSE.GET_VOICE_KEYS, failure());
    await keys();
    expect(
      screen.queryByRole("heading", { name: "Voice Engines" }),
    ).not.toBeInTheDocument();

    await keys(azure());
    expect(
      screen.getByRole("heading", { name: "Voice Engines" }),
    ).toBeInTheDocument();
  });

  it("shows a field for each engine with its saved key", async () => {
    renderWithProviders(<VoiceKeysSection />);

    await keys(azure(), eleven("saved-key"));

    expect(
      form("Azure voices").getByText("(API key, optional)"),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Azure API key...")).toHaveValue("");
    expect(screen.getByPlaceholderText("ElevenLabs API key...")).toHaveValue(
      "saved-key",
    );
  });

  it("saves an engine's key once it changed", async () => {
    const { user } = renderWithProviders(<VoiceKeysSection />);
    await keys(azure(), eleven("saved-key"));
    const save = form("Azure voices").getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    expect(
      form("ElevenLabs voices").getByRole("button", { name: "Save" }),
    ).toBeDisabled();

    await user.type(screen.getByPlaceholderText("Azure API key..."), "abc");
    expect(save).toBeEnabled();
    expect(
      form("ElevenLabs voices").getByRole("button", { name: "Save" }),
    ).toBeDisabled();

    await user.click(save);

    expect(sent(APP_EVENTS.SET_VOICE_KEY)).toEqual([
      { engine: "azure", key: "abc" },
    ]);
  });

  it("can save an empty key to remove one", async () => {
    const { user } = renderWithProviders(<VoiceKeysSection />);
    await keys(eleven("saved-key"));

    await user.clear(screen.getByPlaceholderText("ElevenLabs API key..."));
    await user.click(
      form("ElevenLabs voices").getByRole("button", { name: "Save" }),
    );

    expect(sent(APP_EVENTS.SET_VOICE_KEY)).toEqual([
      { engine: "elevenlabs", key: "" },
    ]);
  });

  it("replaces the typed key when a new one is saved", async () => {
    const { user } = renderWithProviders(<VoiceKeysSection />);
    await keys(azure());
    const input = screen.getByPlaceholderText("Azure API key...");
    await user.type(input, "abc");

    await keys(azure("abc"));

    expect(input).toHaveValue("abc");
    expect(
      form("Azure voices").getByRole("button", { name: "Save" }),
    ).toBeDisabled();

    await keys(azure("from-main"));
    expect(input).toHaveValue("from-main");
  });
});
