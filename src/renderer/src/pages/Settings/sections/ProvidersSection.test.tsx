import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { settingsReply } from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { inList } from "@test/queries";
import { renderWithProviders } from "@test/render";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Settings } from "..";

const tiktok = { name: "Default", key: "", active: false };
const euler = { name: "Euler", key: "euler-key", active: true };

// Two connectors, Euler the active one
const twoConnectors = settingsReply((s) => {
  s.settings.providers.connector = [tiktok, euler];
  s.settings.activeConnProvider = euler;
});

const providers = () =>
  within(
    screen.getByRole("heading", { name: "Providers" }).closest("section")!,
  );
const keyInput = () => screen.getByPlaceholderText("Provider key...");

// The section's visibility is up to the page, so it's tested through it
async function setup(reply = twoConnectors) {
  const app = renderWithProviders(<Settings />);
  await send(APP_EVENTS_RESPONSE.GET_SETTINGS, reply);
  return app;
}

describe("ProvidersSection", () => {
  it("is hidden while there's a single connector", async () => {
    await setup(settingsReply());

    expect(
      screen.queryByRole("heading", { name: "Providers" }),
    ).not.toBeInTheDocument();
  });

  it("shows the active connector and its key", async () => {
    await setup();

    expect(providers().getByText("Euler")).toBeInTheDocument();
    expect(keyInput()).toHaveValue("euler-key");
  });

  it("saves the connector picked with its key", async () => {
    const { user, container } = await setup();

    await user.click(providers().getByText("Euler"));
    await user.click(inList(container, "Default")!);
    await user.clear(keyInput());
    await user.type(keyInput(), "new-key");
    await user.click(providers().getByRole("button", { name: "Save" }));

    expect(sent(APP_EVENTS.SET_PROVIDER)).toEqual([
      { name: "Default", key: "new-key", type: "connector" },
    ]);
  });

  it("starts over from the provider main saved", async () => {
    const { user } = await setup();
    await user.type(keyInput(), "-typed");

    await send(
      APP_EVENTS_RESPONSE.GET_SETTINGS,
      settingsReply((s) => {
        const saved = { ...tiktok, key: "saved-key", active: true };
        s.settings.providers.connector = [saved, { ...euler, active: false }];
        s.settings.activeConnProvider = saved;
      }),
    );

    expect(providers().getByText("Default")).toBeInTheDocument();
    expect(keyInput()).toHaveValue("saved-key");
  });
});
