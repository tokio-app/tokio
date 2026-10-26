import { CatalogOverlay } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE, OverlayApp } from "@/common/types";
import { catalogEntry, failure, overlayApp } from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { renderApp } from "@test/render";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

const GIFT_JAR = catalogEntry("gift-jar", {
  name: "Gift Jar",
  version: "1.2.0",
  description: "Fills a jar with the gifts of your LIVE.",
});
const TOP_LIKES = catalogEntry("top-likes", { name: "Top Likes" });
const CLOCK = catalogEntry("clock", { name: "Clock" });

const overlays = (...data: OverlayApp[]) =>
  send(APP_EVENTS_RESPONSE.GET_OVERLAYS, { success: true, data });

const catalog = (...data: CatalogOverlay[]) =>
  send(APP_EVENTS_RESPONSE.GET_OVERLAY_CATALOG, { success: true, data });

const page = () => within(screen.getByRole("main"));

// The description is the last thing on an overlay's card
const card = (entry: CatalogOverlay) =>
  within(page().getByText(entry.description).parentElement!);

const loading = () =>
  page().queryByRole("status", { name: "Loading" }) !== null;

describe("OfficialOverlays", () => {
  it("asks main for the installed overlays and the catalog", async () => {
    await renderApp("/overlays/official");

    expect(sent(APP_EVENTS.GET_OVERLAYS)).toHaveLength(1);
    expect(sent(APP_EVENTS.GET_OVERLAY_CATALOG)).toHaveLength(1);
  });

  it("shows a loader until the catalog arrives", async () => {
    await renderApp("/overlays/official");
    expect(loading()).toBe(true);

    await catalog(GIFT_JAR);

    expect(loading()).toBe(false);
    expect(page().getByRole("heading", { name: "Gift Jar" })).toBeVisible();
  });

  it("says why the catalog couldn't be loaded, and tries again", async () => {
    const { user } = await renderApp("/overlays/official");

    await send(
      APP_EVENTS_RESPONSE.GET_OVERLAY_CATALOG,
      failure("Unable to reach GitHub."),
    );
    expect(page().getByText("Unable to reach GitHub.")).toBeInTheDocument();
    expect(loading()).toBe(false);

    await user.click(page().getByRole("button", { name: "Try again" }));

    expect(sent(APP_EVENTS.GET_OVERLAY_CATALOG)).toHaveLength(2);
    expect(page().queryByText("Unable to reach GitHub.")).toBeNull();
    expect(page().queryByRole("button", { name: "Try again" })).toBeNull();
    expect(loading()).toBe(true);

    await catalog(GIFT_JAR);

    expect(page().getByRole("heading", { name: "Gift Jar" })).toBeVisible();
  });

  it("explains a failed catalog without a message of its own", async () => {
    await renderApp("/overlays/official");

    await send(APP_EVENTS_RESPONSE.GET_OVERLAY_CATALOG, { success: false });

    expect(
      page().getByText("Unable to load the official overlays."),
    ).toBeInTheDocument();
  });

  it("shows a catalog that comes after a failure", async () => {
    await renderApp("/overlays/official");

    await send(APP_EVENTS_RESPONSE.GET_OVERLAY_CATALOG, { success: false });
    await catalog(GIFT_JAR);

    expect(
      page().queryByText("Unable to load the official overlays."),
    ).toBeNull();
    expect(page().getByRole("heading", { name: "Gift Jar" })).toBeVisible();
  });

  it("keeps the catalog shown when a later read fails", async () => {
    await renderApp("/overlays/official");

    await catalog(GIFT_JAR);
    await send(APP_EVENTS_RESPONSE.GET_OVERLAY_CATALOG, { success: false });

    expect(
      page().queryByText("Unable to load the official overlays."),
    ).toBeNull();
    expect(page().getByRole("heading", { name: "Gift Jar" })).toBeVisible();
  });

  it("says when there are no official overlays yet", async () => {
    await renderApp("/overlays/official");

    await catalog();

    expect(page().getByText("No official overlays yet.")).toBeInTheDocument();
  });

  it("shows each overlay's name, version and description", async () => {
    await renderApp("/overlays/official");

    await catalog(GIFT_JAR, TOP_LIKES);

    expect(card(GIFT_JAR).getByRole("heading")).toHaveTextContent("Gift Jar");
    expect(card(GIFT_JAR).getByText("1.2.0")).toBeInTheDocument();
    expect(card(TOP_LIKES).getByRole("heading")).toHaveTextContent("Top Likes");
    expect(card(TOP_LIKES).getByText("1.0.0")).toBeInTheDocument();
    expect(
      page().getByText("Fills a jar with the gifts of your LIVE."),
    ).toBeInTheDocument();
  });

  it("offers to install, update or remove each overlay", async () => {
    await renderApp("/overlays/official");
    await catalog(GIFT_JAR, TOP_LIKES, CLOCK);

    await overlays(
      overlayApp("gift-jar", { version: "1.0.0" }),
      overlayApp("top-likes"),
      // Imported with the same id, it isn't the official one
      overlayApp("clock", { external: true }),
    );

    const buttons = (entry: CatalogOverlay) =>
      card(entry)
        .queryAllByRole("button")
        .map((button) => button.textContent || button.title);
    expect(buttons(GIFT_JAR)).toEqual(["Update", "Remove"]);
    expect(buttons(TOP_LIKES)).toEqual(["Remove"]);
    expect(card(TOP_LIKES).getByText("Installed")).toBeInTheDocument();
    expect(buttons(CLOCK)).toEqual(["Install"]);
    expect(card(CLOCK).queryByText("Installed")).toBeNull();
  });

  it("installs an overlay, busy until main answers for it", async () => {
    const { user } = await renderApp("/overlays/official");
    await catalog(GIFT_JAR, TOP_LIKES);
    const install = card(GIFT_JAR).getByRole("button", { name: "Install" });

    await user.click(install);

    expect(sent(APP_EVENTS.INSTALL_OVERLAY)).toEqual([{ id: "gift-jar" }]);
    expect(install).toHaveAttribute("aria-busy", "true");
    expect(
      card(TOP_LIKES).getByRole("button", { name: "Install" }),
    ).not.toHaveAttribute("aria-busy");

    await send(APP_EVENTS_RESPONSE.INSTALL_OVERLAY, {
      success: true,
      id: "top-likes",
    });
    expect(install).toHaveAttribute("aria-busy", "true");

    await send(APP_EVENTS_RESPONSE.INSTALL_OVERLAY, {
      success: true,
      id: "gift-jar",
    });
    await overlays(overlayApp("gift-jar", { version: "1.2.0" }));

    expect(card(GIFT_JAR).getByText("Installed")).toBeInTheDocument();
    expect(
      card(GIFT_JAR).queryByRole("button", { name: "Install" }),
    ).toBeNull();
  });

  it("stops being busy when an install fails", async () => {
    const { user } = await renderApp("/overlays/official");
    await catalog(GIFT_JAR);
    const install = card(GIFT_JAR).getByRole("button", { name: "Install" });
    await user.click(install);

    await send(APP_EVENTS_RESPONSE.INSTALL_OVERLAY, {
      ...failure("The download didn't match the catalog."),
      id: "gift-jar",
    });

    expect(install).not.toHaveAttribute("aria-busy");
    expect(install).toHaveTextContent("Install");
  });

  it("updates an overlay, without removing it meanwhile", async () => {
    const { user } = await renderApp("/overlays/official");
    await catalog(GIFT_JAR);
    await overlays(overlayApp("gift-jar", { version: "1.0.0" }));
    const update = card(GIFT_JAR).getByRole("button", { name: "Update" });

    await user.click(update);

    expect(sent(APP_EVENTS.INSTALL_OVERLAY)).toEqual([{ id: "gift-jar" }]);
    expect(update).toHaveAttribute("aria-busy", "true");
    expect(
      card(GIFT_JAR).getByRole("button", { name: "Remove" }),
    ).toBeDisabled();

    await send(APP_EVENTS_RESPONSE.INSTALL_OVERLAY, {
      success: true,
      id: "gift-jar",
    });

    expect(update).not.toHaveAttribute("aria-busy");
    expect(
      card(GIFT_JAR).getByRole("button", { name: "Remove" }),
    ).toBeEnabled();
  });

  it("asks before removing an overlay, and Cancel keeps it", async () => {
    const { user } = await renderApp("/overlays/official");
    await catalog(GIFT_JAR);
    await overlays(overlayApp("gift-jar", { version: "1.2.0" }));

    await user.click(card(GIFT_JAR).getByRole("button", { name: "Remove" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Remove overlay?");
    expect(dialog).toHaveTextContent(
      "Gift Jar and its settings will be deleted. Streaming apps using its URL will stop showing it.",
    );

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(sent(APP_EVENTS.REMOVE_OVERLAY)).toEqual([]);
  });

  it("removes an overlay once confirmed", async () => {
    const { user } = await renderApp("/overlays/official");
    await catalog(GIFT_JAR, TOP_LIKES);
    await overlays(overlayApp("gift-jar", { version: "1.0.0" }));

    await user.click(card(GIFT_JAR).getByRole("button", { name: "Remove" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Remove",
      }),
    );

    expect(sent(APP_EVENTS.REMOVE_OVERLAY)).toEqual([{ id: "gift-jar" }]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a placeholder when a preview can't be loaded", async () => {
    await renderApp("/overlays/official");
    const preview = "https://github.com/tokio-app/overlays/raw/gift-jar.png";

    await catalog({ ...GIFT_JAR, preview }, TOP_LIKES);

    const image = card(GIFT_JAR).getByRole("img", {
      name: "Preview of Gift Jar",
    });
    expect(image).toHaveAttribute("src", preview);
    expect(card(TOP_LIKES).queryByRole("img")).toBeNull();

    fireEvent.error(image);

    expect(card(GIFT_JAR).queryByRole("img")).toBeNull();
    expect(card(GIFT_JAR).getByRole("heading")).toHaveTextContent("Gift Jar");
  });

  it("goes back to the gallery", async () => {
    const { user, router } = await renderApp("/overlays/official");

    await user.click(page().getByRole("button", { name: "Back to Overlays" }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/overlays"),
    );
    expect(
      page().getByRole("heading", { name: "Overlay Gallery" }),
    ).toBeInTheDocument();
  });
});
