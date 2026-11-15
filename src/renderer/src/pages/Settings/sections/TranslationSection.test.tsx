import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { failure, settingsReply } from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { inList, section } from "@test/queries";
import { renderWithProviders } from "@test/render";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Settings } from "..";

const withLanguage = (language: string) =>
  settingsReply((s) => {
    s.settings.translation.language = language;
  });

const translation = () => section("Chat translation");
const textbox = () =>
  screen.getByPlaceholderText("Type a message in another language...");
const testButton = () => translation().getByRole("button", { name: "Test" });
const testId = () => sent(APP_EVENTS.TEST_TRANSLATION).at(-1)!.id;

async function setup(reply = withLanguage("es")) {
  const app = renderWithProviders(<Settings />);
  await send(APP_EVENTS_RESPONSE.GET_SETTINGS, reply);
  return app;
}

const translated = (id: string, over = {}) =>
  send(APP_EVENTS_RESPONSE.TEST_TRANSLATION, {
    success: true,
    id,
    data: {
      kind: "translated",
      translation: { text: "¿de dónde eres?", from: "en", to: "es" },
      ...over,
    },
  });

describe("TranslationSection", () => {
  it("follows the language section", async () => {
    await setup();

    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(headings.indexOf("Chat translation")).toBe(
      headings.indexOf("Language") + 1,
    );
  });

  it("saves the language picked, Off first and the rest by name", async () => {
    const { user, container } = await setup(withLanguage(""));
    await user.click(translation().getByText("Off"));

    const names = screen.getAllByRole("option").map((o) => o.textContent);
    expect(names.slice(0, 3)).toEqual(["Off", "Arabic", "Bulgarian"]);

    await user.type(screen.getByPlaceholderText("Search..."), "Spanish");
    await user.click(inList(container, "Spanish")!);
    expect(sent(APP_EVENTS.SET_TRANSLATION)).toEqual([{ language: "es" }]);
    expect(translation().getByText("Spanish")).toBeInTheDocument();

    await user.click(translation().getByText("Spanish"));
    await user.type(screen.getByPlaceholderText("Search..."), "Off");
    await user.click(inList(container, "Off")!);
    expect(sent(APP_EVENTS.SET_TRANSLATION).at(-1)).toEqual({ language: "" });
  });

  it("shows the tester only with a language, Test waiting for text", async () => {
    const { user } = await setup(withLanguage(""));
    expect(
      screen.queryByPlaceholderText("Type a message in another language..."),
    ).not.toBeInTheDocument();
    expect(
      translation().queryByRole("button", { name: "Test" }),
    ).not.toBeInTheDocument();

    await send(APP_EVENTS_RESPONSE.GET_SETTINGS, withLanguage("es"));
    expect(testButton()).toBeDisabled();
    await user.type(textbox(), "hello");
    expect(testButton()).toBeEnabled();
  });

  it("hides a result once the language changes", async () => {
    const { user } = await setup();
    await user.type(textbox(), "where are you from?");
    await user.click(testButton());
    await translated(testId());
    expect(translation().getByText("¿de dónde eres?")).toBeInTheDocument();

    await send(APP_EVENTS_RESPONSE.GET_SETTINGS, withLanguage("fr"));
    expect(
      translation().queryByText("¿de dónde eres?"),
    ).not.toBeInTheDocument();

    await send(APP_EVENTS_RESPONSE.GET_SETTINGS, withLanguage("es"));
    expect(translation().getByText("¿de dónde eres?")).toBeInTheDocument();
  });

  it("shows a translation as the feed's row, with its language", async () => {
    const { user } = await setup();
    await user.type(textbox(), "where are you from?");
    await user.click(testButton());

    const id = testId();
    expect(id).toMatch(/^translation-test:\d+$/);
    expect(sent(APP_EVENTS.TEST_TRANSLATION).at(-1)).toEqual({
      id,
      text: "where are you from?",
    });
    // Busy: named by its spinner
    expect(
      translation().getByRole("button", { name: "Loading" }),
    ).toBeInTheDocument();

    await translated(id);

    expect(translation().getByText("A viewer")).toBeInTheDocument();
    expect(translation().getByText("where are you from?")).toBeInTheDocument();
    const line = translation().getByText("¿de dónde eres?");
    expect(line).toHaveAttribute("lang", "es");
    expect(
      translation().getByText("Translated from English:"),
    ).toBeInTheDocument();
    expect(
      translation().getByText("Google translated it from English."),
    ).toBeInTheDocument();
    expect(testButton()).toBeEnabled();
  });

  it("shows a sentence without a row for the other answers", async () => {
    const { user } = await setup();
    await user.type(textbox(), "hola");
    await user.click(testButton());
    await send(APP_EVENTS_RESPONSE.TEST_TRANSLATION, {
      success: true,
      id: testId(),
      data: { kind: "same", from: "es" },
    });
    expect(translation().getByText("It's already in Spanish.")).toBeVisible();
    expect(translation().queryByText("A viewer")).not.toBeInTheDocument();

    await user.click(testButton());
    await send(APP_EVENTS_RESPONSE.TEST_TRANSLATION, {
      success: true,
      id: testId(),
      data: { kind: "command" },
    });
    expect(
      translation().getByText("Chat commands and keywords stay as typed."),
    ).toBeVisible();
    expect(
      translation().queryByText("It's already in Spanish."),
    ).not.toBeInTheDocument();

    await user.click(testButton());
    await send(APP_EVENTS_RESPONSE.TEST_TRANSLATION, {
      ...failure("Google didn't answer. Check your connection and try again."),
      id: testId(),
    });
    expect(
      translation().getByText(
        "Google didn't answer. Check your connection and try again.",
      ),
    ).toBeVisible();
  });

  it("ignores a late reply for an older test", async () => {
    const { user } = await setup();
    await user.type(textbox(), "one");
    await user.click(testButton());
    const first = testId();
    await translated(first);
    await user.click(testButton());
    const second = testId();
    expect(second).not.toBe(first);

    await translated(first, {
      translation: { text: "viejo", from: "en", to: "es" },
    });
    expect(translation().queryByText("viejo")).not.toBeInTheDocument();
    expect(
      translation().getByRole("button", { name: "Loading" }),
    ).toBeInTheDocument();

    await translated(second);
    expect(translation().getByText("¿de dónde eres?")).toBeInTheDocument();
  });
});
