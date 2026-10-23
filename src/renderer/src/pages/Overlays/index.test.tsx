import { CatalogOverlay } from "@/common/schemas";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  OverlayApp,
  TOKIO_EVENTS,
  TokioPayload,
} from "@/common/types";
import {
  catalogEntry,
  failure,
  gift,
  overlayApp,
  overlayConfig,
} from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { renderApp } from "@test/render";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const GIFT_JAR = overlayApp("gift-jar", { name: "Gift Jar" });
const TOP_LIKES = overlayApp("top-likes", { name: "Top Likes" });
const GIFTS = [gift(1, "Rose"), gift(5655, "Lion")];

const PAYLOADS: TokioPayload[] = [
  { type: TOKIO_EVENTS.ENVELOPE, data: undefined },
  { type: TOKIO_EVENTS.SUPER_FAN_BOX, data: undefined },
];

const preview = (payload: TokioPayload) => ({
  action: "TOKIO_PREVIEW",
  payload,
});

const overlays = (...data: OverlayApp[]) =>
  send(APP_EVENTS_RESPONSE.GET_OVERLAYS, { success: true, data });

const catalog = (...data: CatalogOverlay[]) =>
  send(APP_EVENTS_RESPONSE.GET_OVERLAY_CATALOG, { success: true, data });

// Gift Jar's settings, which customize() asks for
const loadConfig = () =>
  send(APP_EVENTS_RESPONSE.GET_OVERLAY_CONFIG, {
    success: true,
    id: "gift-jar",
    data: overlayConfig(),
  });
const page = () => within(screen.getByRole("main"));
const dialog = () => within(screen.getByRole("dialog"));
const search = () => screen.getByPlaceholderText("Search overlays...");

// An overlay's card in the gallery, around its preview. The settings have the
// overlay's name as title too.
function cardOf(name: string) {
  let el = page()
    .getAllByRole("heading", { name, level: 3 })
    .find((heading) => !heading.closest("[role=dialog]"))!;
  while (!el.querySelector("iframe")) el = el.parentElement!;
  return el;
}

const card = (name: string) => within(cardOf(name));

// Records what the preview in a card or in the settings is posted
function spyPreview(container: HTMLElement) {
  const frame = container.querySelector("iframe");
  return vi.spyOn(frame!.contentWindow!, "postMessage");
}

// The gallery with Gift Jar's settings open
async function customize() {
  const app = await renderApp("/overlays");
  await overlays(GIFT_JAR, TOP_LIKES);
  await send(APP_EVENTS_RESPONSE.GET_GIFTS, { data: GIFTS });
  await app.user.click(
    card("Gift Jar").getByRole("button", { name: "Customize" }),
  );
  return app;
}

describe("Overlays", () => {
  it("asks main for the overlays, the gifts and the official catalog", async () => {
    await renderApp("/overlays");

    expect(sent(APP_EVENTS.GET_OVERLAYS)).toHaveLength(1);
    expect(sent(APP_EVENTS.GET_GIFTS)).toHaveLength(1);
    expect(sent(APP_EVENTS.GET_OVERLAY_CATALOG)).toHaveLength(1);
  });

  it("shows a card for each overlay", async () => {
    await renderApp("/overlays");

    await overlays(GIFT_JAR, overlayApp("clock", { name: "Clock" }));

    const names = page()
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent);
    expect(names).toEqual(["Gift Jar", "Clock"]);
    expect(screen.getByTitle("Viewer for gift-jar")).toHaveAttribute(
      "name",
      "TOKIO_APP-gift-jar",
    );
  });

  it("says how to get overlays when there are none", async () => {
    await renderApp("/overlays");

    await overlays();

    expect(
      page().getByText(
        "No overlays yet. Install an official one, or import your own in Settings.",
      ),
    ).toBeInTheDocument();
  });

  it("searches the overlays by name", async () => {
    const { user } = await renderApp("/overlays");
    await overlays(GIFT_JAR, TOP_LIKES);

    await user.click(page().getByRole("button", { name: "Search" }));
    expect(
      page().getByRole("button", { name: "Close search" }),
    ).toBeInTheDocument();
    await user.type(search(), "JAR");

    expect(page().getByRole("heading", { name: "Gift Jar" })).toBeVisible();
    expect(page().queryByRole("heading", { name: "Top Likes" })).toBeNull();

    await user.type(search(), "s");

    expect(page().getByText("No overlays found.")).toBeInTheDocument();
    expect(page().queryByRole("heading", { level: 3 })).toBeNull();
  });

  it("puts the focus in the search when it opens", async () => {
    const { user } = await renderApp("/overlays");

    await user.click(page().getByRole("button", { name: "Search" }));

    expect(search()).toHaveFocus();
  });

  it("clears the search when it's closed", async () => {
    const { user } = await renderApp("/overlays");
    await overlays(GIFT_JAR, TOP_LIKES);
    await user.click(page().getByRole("button", { name: "Search" }));
    await user.type(search(), "likes");

    await user.click(page().getByRole("button", { name: "Close search" }));

    expect(search()).toHaveValue("");
    expect(page().getAllByRole("heading", { level: 3 })).toHaveLength(2);
    expect(page().getByRole("button", { name: "Search" })).toBeInTheDocument();
  });

  // Only CSS hides it, typing there would filter the gallery unseen
  it("keeps the closed search out of the keyboard's reach", async () => {
    const { user } = await renderApp("/overlays");
    await overlays(GIFT_JAR, TOP_LIKES);
    const button = page().getByRole("button", { name: "Search" });

    const reached: Element[] = [];
    while (document.activeElement !== button && reached.length < 50) {
      await user.tab();
      reached.push(document.activeElement!);
    }

    expect(reached).toContain(button);
    expect(reached).not.toContain(search());
  });

  it("tests an overlay from its card", async () => {
    const { user } = await renderApp("/overlays");
    await overlays(GIFT_JAR, TOP_LIKES);

    await user.click(card("Top Likes").getByRole("button", { name: "Test" }));

    expect(sent(APP_EVENTS.TEST_OVERLAY)).toEqual([{ id: "top-likes" }]);
  });

  it("only offers Customize for overlays with settings", async () => {
    await renderApp("/overlays");

    await overlays(GIFT_JAR, overlayApp("clock", { config: false }));

    expect(
      card("Gift Jar").getByRole("button", { name: "Customize" }),
    ).toBeInTheDocument();
    expect(
      card("clock").queryByRole("button", { name: "Customize" }),
    ).toBeNull();
  });

  it("opens an overlay's settings once main sends them", async () => {
    await customize();

    expect(sent(APP_EVENTS.GET_OVERLAY_CONFIG)).toEqual([{ id: "gift-jar" }]);
    expect(
      dialog().getByRole("heading", { name: "Gift Jar" }),
    ).toBeInTheDocument();
    expect(dialog().queryByText("General")).toBeNull();

    await loadConfig();

    expect(dialog().getByText("General")).toBeInTheDocument();
    expect(dialog().getByPlaceholderText("Type a title")).toHaveValue("Goal");
    expect(dialog().getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("ignores settings meant for another overlay", async () => {
    await customize();

    await send(APP_EVENTS_RESPONSE.GET_OVERLAY_CONFIG, {
      success: true,
      id: "top-likes",
      data: overlayConfig(),
    });
    await send(APP_EVENTS_RESPONSE.GET_OVERLAY_CONFIG, {
      ...failure(),
      id: "top-likes",
    });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(dialog().queryByText("General")).toBeNull();
  });

  it("closes the settings when they can't be loaded", async () => {
    await customize();

    await send(APP_EVENTS_RESPONSE.GET_OVERLAY_CONFIG, {
      ...failure(),
      id: "gift-jar",
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes the settings on Cancel without saving", async () => {
    const { user } = await customize();
    await loadConfig();
    await user.type(dialog().getByPlaceholderText("Type a title"), "!");

    await user.click(dialog().getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(sent(APP_EVENTS.SAVE_OVERLAY_CONFIG)).toEqual([]);
  });

  it("saves the settings, then updates the previews", async () => {
    const { user } = await customize();
    await loadConfig();
    const title = dialog().getByPlaceholderText("Type a title");
    await user.clear(title);
    await user.type(title, "Raise");
    const save = dialog().getByRole("button", { name: "Save" });

    await user.click(save);

    const { sections, fields } = overlayConfig();
    const [titleField, ...rest] = fields;
    expect(sent(APP_EVENTS.SAVE_OVERLAY_CONFIG)).toEqual([
      {
        config: {
          sections,
          fields: [
            {
              ...titleField,
              attributes: { ...titleField.attributes, value: "Raise" },
            },
            ...rest,
          ],
        },
        id: "gift-jar",
      },
    ]);
    expect(save).toHaveAttribute("aria-busy", "true");

    const cardPreview = spyPreview(cardOf("Gift Jar"));
    const data = { title: "Raise", size: 50, show: true };
    await send(APP_EVENTS_RESPONSE.SAVE_OVERLAY_CONFIG, {
      success: true,
      id: "gift-jar",
      data,
    });

    const payload: TokioPayload = { type: "tokio:config", data };
    expect(cardPreview).toHaveBeenCalledWith(preview(payload), "*");
    // Main sends them to the live overlays.
    expect(sent(APP_EVENTS.SEND_OVERLAY_DATA)).toEqual([]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("previews the unsaved settings in the settings alone", async () => {
    const { user } = await customize();
    const cardPreview = spyPreview(cardOf("Gift Jar"));
    const settingsPreview = spyPreview(screen.getByRole("dialog"));
    fireEvent.load(dialog().getByTitle("Viewer for gift-jar"));

    await loadConfig();
    await user.type(dialog().getByPlaceholderText("Type a title"), "!");

    const config = (title: string): TokioPayload => ({
      type: "tokio:config",
      data: { title, size: 50, show: true },
    });
    expect(settingsPreview).toHaveBeenCalledWith(preview(config("Goal")), "*");
    expect(settingsPreview).toHaveBeenLastCalledWith(
      preview(config("Goal!")),
      "*",
    );
    expect(cardPreview).not.toHaveBeenCalled();
    expect(sent(APP_EVENTS.SEND_OVERLAY_DATA)).toEqual([]);
  });

  it("keeps the settings open when they can't be saved", async () => {
    const { user } = await customize();
    await loadConfig();
    await user.type(dialog().getByPlaceholderText("Type a title"), "!");
    await user.click(dialog().getByRole("button", { name: "Save" }));

    await send(APP_EVENTS_RESPONSE.SAVE_OVERLAY_CONFIG, {
      ...failure(),
      id: "gift-jar",
    });

    expect(dialog().getByRole("button", { name: "Save" })).not.toHaveAttribute(
      "aria-busy",
    );
    expect(sent(APP_EVENTS.SEND_OVERLAY_DATA)).toEqual([]);
  });

  it("updates the overlay an earlier save was for, and leaves the open settings alone", async () => {
    const { user } = await customize();
    await loadConfig();
    await user.type(dialog().getByPlaceholderText("Type a title"), "!");
    await user.click(dialog().getByRole("button", { name: "Save" }));
    await user.click(dialog().getByRole("button", { name: "Cancel" }));
    await user.click(
      card("Top Likes").getByRole("button", { name: "Customize" }),
    );
    await send(APP_EVENTS_RESPONSE.GET_OVERLAY_CONFIG, {
      success: true,
      id: "top-likes",
      data: overlayConfig(),
    });

    const cardPreview = spyPreview(cardOf("Gift Jar"));
    const data = { title: "Goal!", size: 50, show: true };
    await send(APP_EVENTS_RESPONSE.SAVE_OVERLAY_CONFIG, {
      success: true,
      id: "gift-jar",
      data,
    });

    expect(
      dialog().getByRole("heading", { name: "Top Likes" }),
    ).toBeInTheDocument();
    expect(dialog().getByRole("button", { name: "Save" })).not.toHaveAttribute(
      "aria-busy",
    );
    expect(cardPreview).toHaveBeenCalledWith(
      preview({ type: "tokio:config", data }),
      "*",
    );
  });

  it("stops saving when the settings close", async () => {
    const { user } = await customize();
    await loadConfig();
    await user.type(dialog().getByPlaceholderText("Type a title"), "!");
    await user.click(dialog().getByRole("button", { name: "Save" }));
    await user.click(dialog().getByRole("button", { name: "Cancel" }));

    await user.click(
      card("Gift Jar").getByRole("button", { name: "Customize" }),
    );
    await loadConfig();

    expect(dialog().getByRole("button", { name: "Save" })).not.toHaveAttribute(
      "aria-busy",
    );
  });

  it("plays test events on the live overlay and its card", async () => {
    await renderApp("/overlays");
    await overlays(GIFT_JAR, TOP_LIKES);
    const cardPreview = spyPreview(cardOf("Gift Jar"));
    const otherPreview = spyPreview(cardOf("Top Likes"));

    await send(APP_EVENTS_RESPONSE.TEST_OVERLAY, {
      id: "gift-jar",
      payloads: PAYLOADS,
    });

    expect(sent(APP_EVENTS.SEND_OVERLAY_DATA)).toEqual([
      { id: "gift-jar", payload: PAYLOADS[0] },
      { id: "gift-jar", payload: PAYLOADS[1] },
    ]);
    expect(cardPreview.mock.calls).toEqual([
      [preview(PAYLOADS[0]), "*"],
      [preview(PAYLOADS[1]), "*"],
    ]);
    expect(otherPreview).not.toHaveBeenCalled();
  });

  it("tests from the settings only in the previews, never on stream", async () => {
    const { user } = await customize();
    await loadConfig();

    await user.click(dialog().getByRole("button", { name: "Test" }));
    expect(sent(APP_EVENTS.TEST_OVERLAY)).toEqual([{ id: "gift-jar" }]);

    const cardPreview = spyPreview(cardOf("Gift Jar"));
    const settingsPreview = spyPreview(screen.getByRole("dialog"));
    await send(APP_EVENTS_RESPONSE.TEST_OVERLAY, {
      id: "gift-jar",
      payloads: PAYLOADS,
    });

    expect(sent(APP_EVENTS.SEND_OVERLAY_DATA)).toEqual([]);
    for (const spy of [cardPreview, settingsPreview]) {
      expect(spy).toHaveBeenCalledWith(preview(PAYLOADS[0]), "*");
      expect(spy).toHaveBeenCalledWith(preview(PAYLOADS[1]), "*");
    }
  });

  it("warns when an overlay has no preview to post to", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await renderApp("/overlays");
    await overlays(GIFT_JAR);

    await send(APP_EVENTS_RESPONSE.TEST_OVERLAY, {
      id: "removed",
      payloads: [PAYLOADS[0]],
    });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("removed"));
    // The live overlay still gets it
    expect(sent(APP_EVENTS.SEND_OVERLAY_DATA)).toEqual([
      { id: "removed", payload: PAYLOADS[0] },
    ]);
  });

  it("marks Official Overlays while an installed one has an update", async () => {
    await renderApp("/overlays");
    await overlays(GIFT_JAR, TOP_LIKES);

    await catalog(
      catalogEntry("gift-jar", { version: "1.1.0" }),
      catalogEntry("top-likes"),
    );

    const button = page().getByRole("button", {
      name: "Official Overlays, 1 update available",
    });
    expect(button).toHaveAttribute("title", "1 update available");
  });

  it("counts every update on Official Overlays", async () => {
    await renderApp("/overlays");
    await overlays(GIFT_JAR, TOP_LIKES);

    await catalog(
      catalogEntry("gift-jar", { version: "1.1.0" }),
      catalogEntry("top-likes", { version: "2.0.0" }),
    );

    expect(
      page().getByRole("button", {
        name: "Official Overlays, 2 updates available",
      }),
    ).toBeInTheDocument();
  });

  it("doesn't mark Official Overlays for up to date or imported overlays", async () => {
    await renderApp("/overlays");
    await overlays(GIFT_JAR, overlayApp("clock", { external: true }));

    await catalog(
      catalogEntry("gift-jar"),
      catalogEntry("clock", { version: "2.0.0" }),
      catalogEntry("top-likes", { version: "3.0.0" }),
    );

    const button = page().getByRole("button", { name: "Official Overlays" });
    expect(button).not.toHaveAttribute("title");
    expect(button).not.toHaveAttribute("aria-label");
  });

  it("doesn't mark Official Overlays without the catalog", async () => {
    await renderApp("/overlays");
    await overlays(GIFT_JAR);

    await send(APP_EVENTS_RESPONSE.GET_OVERLAY_CATALOG, failure("Offline."));

    expect(
      page().getByRole("button", { name: "Official Overlays" }),
    ).not.toHaveAttribute("title");
  });

  it("opens Official Overlays", async () => {
    const { user, router } = await renderApp("/overlays");

    await user.click(page().getByRole("button", { name: "Official Overlays" }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/overlays/official"),
    );
    expect(
      page().getByRole("heading", { name: "Official Overlays" }),
    ).toBeInTheDocument();
  });
});
