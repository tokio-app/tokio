import {
  StudioLayer,
  StudioLayerOf,
  StudioLayerSchema,
  StudioOverlay,
} from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE, TOKIO_EVENTS } from "@/common/types";
import { newStudioLayer } from "@/common/util";
import { createAction } from "@/pages/Games/helper";
import { createAlert } from "@/pages/Alerts/helper";
import {
  overlayApp,
  profileReply,
  settingsReply,
  studioOverlay,
  timerReply,
} from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { inList } from "@test/queries";
import { renderApp } from "@test/render";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const ID = "1b4e28ba-2fa1-41d2-883f-0016d3cca427";

const text = (patch: Partial<StudioLayerOf<"text">> = {}) =>
  StudioLayerSchema.parse({ ...newStudioLayer("text", "portrait"), ...patch });
const layerOf = <K extends StudioLayer["kind"]>(
  kind: K,
  patch: Partial<StudioLayerOf<K>> = {},
) => StudioLayerSchema.parse({ ...newStudioLayer(kind, "portrait"), ...patch });

const studio = (...data: StudioOverlay[]) =>
  send(APP_EVENTS_RESPONSE.STUDIO, { success: true, data });

async function open(overlay: StudioOverlay) {
  const view = await renderApp(`/tools/studio/${overlay.id}`);
  await studio(overlay);
  return view;
}

// The newest overlay sent to be saved
const lastSave = () => sent(APP_EVENTS.SAVE_STUDIO_OVERLAY).at(-1)?.overlay;
const saved = async () => {
  await waitFor(() => expect(lastSave()).toBeDefined());
  return lastSave()!;
};

const page = () => within(screen.getByRole("main"));
const layers = () => within(page().getByRole("list", { name: "Layers" }));
const row = (name: RegExp) => layers().getByRole("button", { name });
const canvas = () => page().getByLabelText(/^Canvas./);
const drawn = (id: string) =>
  canvas().querySelector<HTMLElement>(`[data-layer="${id}"]`)!;
const field = (name: string) => within(page().getByRole("group", { name }));

describe("StudioEditor", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("waits for main's list, then shows the overlay", async () => {
    await renderApp(`/tools/studio/${ID}`);

    expect(sent(APP_EVENTS.GET_STUDIO)).toHaveLength(1);
    expect(page().getByRole("status", { name: "Loading" })).toBeVisible();

    await studio(studioOverlay("Main scene", { id: ID }));

    expect(page().getByRole("heading", { name: "Main scene" })).toBeVisible();
    expect(
      page().getByText("1080 × 1920", { selector: "[class*=canvas_size]" }),
    ).toBeVisible();
    expect(page().getByText(/^No layers yet\./)).toBeVisible();
  });

  it("says when the overlay was deleted, with a way back", async () => {
    const { user, router } = await renderApp(`/tools/studio/${ID}`);

    await studio(studioOverlay("Other"));

    expect(page().getByText("This overlay was deleted.")).toBeVisible();
    await user.click(page().getByTitle("Back to Overlay Studio"));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/tools/studio"),
    );
  });

  it("names an empty overlay as untitled, and saves a new name", async () => {
    const { user } = await open(studioOverlay("", { id: ID }));

    expect(
      page().getByRole("heading", { name: "Untitled overlay" }),
    ).toBeVisible();
    await user.type(field("Name").getByRole("textbox"), "Main");

    expect((await saved()).name).toBe("Main");
  });

  it("switches the canvas to Landscape", async () => {
    const { user } = await open(studioOverlay("Main", { id: ID }));

    await user.click(page().getByRole("radio", { name: /Landscape/ }));

    expect((await saved()).size).toBe("landscape");
    expect(
      page().getByText("1920 × 1080", { selector: "[class*=canvas_size]" }),
    ).toBeVisible();
    expect(
      canvas().querySelector<HTMLElement>(".studio-canvas")!.style.width,
    ).toBe("1920px");
  });

  it("copies the overlay's URL from the header", async () => {
    const { user } = await open(studioOverlay("Main", { id: ID }));

    const [header] = page().getAllByTitle("Copy overlay URL");
    await user.click(header);

    expect(await navigator.clipboard.readText()).toBe(
      `http://tokio-app.local:37891/studio/${ID}/`,
    );
  });

  it("adds each kind of layer from the menu, in front, and selects it", async () => {
    const { user } = await open(studioOverlay("Main", { id: ID }));
    const kinds = [
      "Text",
      "Image or video",
      "Gift",
      "Emote",
      "Shape",
      "Viewer's picture",
      "Overlay",
    ];

    for (const kind of kinds) {
      await user.click(page().getByRole("button", { name: "Add a layer" }));
      await user.click(screen.getByRole("menuitem", { name: kind }));
      expect(page().getByRole("heading", { name: kind })).toBeVisible();
    }

    const overlay = await waitFor(() => {
      const last = lastSave();
      expect(last?.layers).toHaveLength(7);
      return last!;
    });
    expect(overlay.layers.map((l) => l.kind)).toEqual([
      "text",
      "media",
      "gift",
      "emote",
      "shape",
      "viewer",
      "overlay",
    ]);
    // Front on top
    const names = layers()
      .getAllByRole("listitem")
      .map((li) => li.querySelector("[class*=layer_name]")!.textContent);
    expect(names).toEqual([...kinds].reverse());
    // A viewer's picture waits for an event
    expect(overlay.layers[5].when).toBe("event");
  });

  it("selects a layer from the list or the canvas, and Escape deselects", async () => {
    const back = layerOf("shape");
    const front = text({ text: "Hello" });
    const { user } = await open(
      studioOverlay("Main", { id: ID, layers: [back, front] }),
    );

    await user.click(row(/^Hello/));
    expect(page().getByRole("heading", { name: "Text" })).toBeVisible();
    expect(row(/^Hello/)).toHaveAttribute("aria-pressed", "true");

    fireEvent.pointerDown(drawn(back.id), { button: 0 });
    expect(page().getByRole("heading", { name: "Shape" })).toBeVisible();
    expect(canvas()).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(
      page().getByRole("heading", { name: "Overlay settings" }),
    ).toBeVisible();
  });

  it("nudges the selected layer with the arrows, Shift ten px", async () => {
    const shape = layerOf("shape", { x: 100, y: 200 });
    const { user } = await open(
      studioOverlay("Main", { id: ID, layers: [shape] }),
    );

    await user.click(row(/^Shape/));
    canvas().focus();
    await user.keyboard("{ArrowRight}{ArrowRight}{Shift>}{ArrowDown}{/Shift}");

    await waitFor(() =>
      expect(lastSave()?.layers[0]).toMatchObject({ x: 102, y: 210 }),
    );
    expect(drawn(shape.id).style.left).toBe("102px");
    expect(field("X").getByRole("spinbutton")).toHaveValue(102);
  });

  it("drags a layer and its corner, in the canvas's px", async () => {
    Element.prototype.setPointerCapture = vi.fn();
    const shape = layerOf("shape", { x: 100, y: 200, width: 300, height: 100 });
    await open(studioOverlay("Main", { id: ID, layers: [shape] }));
    // Half size: 540 × 960 on screen
    const root = canvas().querySelector<HTMLElement>(".studio-stage")!;
    vi.spyOn(root, "clientWidth", "get").mockReturnValue(540);
    vi.spyOn(root, "clientHeight", "get").mockReturnValue(960);

    fireEvent.pointerDown(drawn(shape.id), {
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(canvas(), { clientX: 20, clientY: 15.4 });
    fireEvent.pointerUp(canvas());
    fireEvent.pointerDown(canvas().querySelector("[data-handle]")!, {
      button: 0,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(canvas(), { clientX: -200, clientY: -100 });
    fireEvent.pointerUp(canvas());

    await waitFor(() =>
      expect(lastSave()?.layers[0]).toMatchObject({
        x: 120,
        y: 211,
        // Never under 1
        width: 1,
        height: 1,
      }),
    );
  });

  it("reorders layers from the keyboard, up the list toward the front", async () => {
    const a = text({ text: "Back" });
    const b = text({ text: "Front" });
    const { user } = await open(
      studioOverlay("Main", { id: ID, layers: [a, b] }),
    );

    const grips = layers().getAllByRole("button", {
      name: "Drag to reorder, or use the arrow keys",
    });
    grips[1].focus();
    await user.keyboard("{ArrowUp}");

    await waitFor(() =>
      expect(lastSave()?.layers.map((l) => l.id)).toEqual([b.id, a.id]),
    );
    expect(drawn(a.id).style.zIndex).toBe("1");
  });

  it("deletes a layer", async () => {
    const shape = layerOf("shape");
    const { user } = await open(
      studioOverlay("Main", { id: ID, layers: [shape] }),
    );

    await user.click(layers().getByRole("button", { name: "Delete layer" }));

    expect((await saved()).layers).toEqual([]);
    expect(canvas().querySelector("[data-layer]")).toBeNull();
  });

  it("fills a text's numbers with samples, and saves its text", async () => {
    const layer = text({ text: "{likes} likes" });
    const { user } = await open(
      studioOverlay("Main", { id: ID, layers: [layer] }),
    );

    expect(drawn(layer.id)).toHaveTextContent("12.8K likes");

    await user.click(row(/likes/));
    await user.click(page().getByTitle("Insert {viewers}"));

    expect((await saved()).layers[0]).toMatchObject({
      text: "{likes} likes{viewers}",
    });
  });

  it("makes a layer show on an event, with its trigger, seconds and entrance", async () => {
    const layer = text({ text: "Thanks {username}" });
    const { user } = await open(
      studioOverlay("Main", { id: ID, layers: [layer] }),
    );
    await user.click(row(/^Thanks/));

    await user.click(page().getByRole("radio", { name: "Shows on an event" }));
    // A sample viewer's name
    expect(drawn(layer.id)).not.toHaveTextContent("{username}");
    expect(drawn(layer.id).className).toMatch(/studio-waits/);
    expect(row(/^Thanks/)).toHaveTextContent("Text, shows on Follow");

    const trigger = page().getByRole("group", { name: "Trigger" });
    await user.click(within(trigger).getByText("Follow"));
    await user.click(inList(trigger, "Like")!);
    const likes = field("Trigger").getByRole("spinbutton", {
      name: "Likes per reaction",
    });
    await user.clear(likes);
    await user.type(likes, "50");

    await waitFor(() =>
      expect(lastSave()?.layers[0]).toMatchObject({
        when: "event",
        trigger: { type: TOKIO_EVENTS.LIKE },
        likes_every: 50,
      }),
    );
    expect(field("Seconds on screen").getByRole("spinbutton")).toHaveValue(5);
  });

  it("offers a viewer's picture only the event Whens", async () => {
    const { user } = await open(
      studioOverlay("Main", { id: ID, layers: [layerOf("viewer")] }),
    );

    await user.click(row(/^Viewer's picture/));

    expect(
      page().queryByRole("radio", { name: "Always on screen" }),
    ).not.toBeInTheDocument();
    expect(
      page().getByRole("radio", { name: "Shows on an event" }),
    ).toBeChecked();
  });

  it("tests: saves what's waiting, plays the event layers and asks main to", async () => {
    const shows = text({ text: "Hi {username}", when: "event" });
    const always = text({ text: "Always" });
    const { user } = await open(
      studioOverlay("Main", { id: ID, layers: [shows, always] }),
    );
    await user.click(row(/^Always/));
    await user.type(field("Text").getByRole("textbox"), "!");

    await user.click(
      page().getByRole("button", {
        name: "Test the layers that react to events",
      }),
    );

    expect(lastSave()?.layers[1]).toMatchObject({ text: "Always!" });
    expect(sent(APP_EVENTS.TEST_STUDIO_OVERLAY)).toEqual([{ id: ID }]);
    const body = drawn(shows.id).querySelector(".studio-body")!;
    expect(body.className).toMatch(/studio-enter-pop/);
    expect(
      drawn(always.id).querySelector(".studio-body")!.className,
    ).not.toMatch(/studio-enter/);
  });

  it("clears a deleted file from its media layers", async () => {
    const media = layerOf("media", { file: "party.png", name: "Party" });
    const { user } = await open(
      studioOverlay("Main", { id: ID, layers: [media] }),
    );
    await user.click(row(/^Party/));

    await send(APP_EVENTS_RESPONSE.ALERT_FILE_REMOVED, {
      field: "media",
      file: "party.png",
    });

    expect((await saved()).layers[0]).toMatchObject({ file: "", name: "" });
    expect(page().getByRole("button", { name: "Pick a file" })).toBeVisible();
  });

  it("takes a browsed file only while its layer waits for one", async () => {
    const media = layerOf("media");
    const { user } = await open(
      studioOverlay("Main", { id: ID, layers: [media] }),
    );
    await user.click(row(/^Image or video/));
    await user.click(page().getByRole("button", { name: "Pick a file" }));
    await user.click(screen.getByRole("button", { name: "Browse file..." }));
    const [{ request }] = sent(APP_EVENTS.IMPORT_MEDIA);

    // Another layer's reply, and one for a request not made
    await send(APP_EVENTS_RESPONSE.SET_ALERT_MEDIA, {
      success: true,
      id: "other",
      request,
      media: { name: "Clip", file: "clip.webm" },
    });
    await send(APP_EVENTS_RESPONSE.SET_ALERT_MEDIA, {
      success: true,
      id: media.id,
      request,
      media: { name: "Party", file: "party.png" },
    });

    expect((await saved()).layers[0]).toMatchObject({
      file: "party.png",
      name: "Party",
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("frames an installed overlay from disk, transparent, and says when it's gone", async () => {
    const jar = layerOf("overlay", {
      source: { type: "installed", id: "gift-jar" },
    });
    const gone = layerOf("overlay", {
      source: { type: "installed", id: "old" },
    });
    await open(studioOverlay("Main", { id: ID, layers: [jar, gone] }));

    await send(APP_EVENTS_RESPONSE.GET_OVERLAYS, {
      success: true,
      data: [overlayApp("gift-jar")],
    });

    const frame = within(drawn(jar.id)).getByTitle("Viewer for gift-jar");
    expect(frame).toHaveAttribute("name", "TOKIO_APP-gift-jar");
    expect(frame.getAttribute("src")).toMatch(/index\.html\?transparent$/);
    expect(drawn(gone.id)).toHaveTextContent(/^This overlay was removed\./);
  });

  it("draws the timer's and the games overlay's previews without their panels", async () => {
    const timer = layerOf("overlay", { source: { type: "timer" } });
    const games = layerOf("overlay", { source: { type: "games" } });
    await open(studioOverlay("Main", { id: ID, layers: [timer, games] }));

    await send(APP_EVENTS_RESPONSE.TIMER, timerReply());
    await send(
      APP_EVENTS_RESPONSE.GET_PROFILE,
      profileReply((p) => {
        p.games.actions = [
          {
            ...createAction("bedrock"),
            overlay: {
              show: true,
              image: null,
              event: "",
              name: "TNT rain",
              column: 1,
            },
          },
        ];
      }),
    );

    expect(
      within(drawn(timer.id)).getByRole("timer", { hidden: true }),
    ).toHaveTextContent("01:00:00");
    expect(
      drawn(timer.id).querySelector("[class*=preview_bare]"),
    ).not.toBeNull();
    expect(drawn(games.id)).toHaveTextContent("TNT rain");
    expect(
      drawn(games.id).querySelector("[class*=preview_bare]"),
    ).not.toBeNull();
  });

  it("names an alert's embed, and offers only alerts with media", async () => {
    const quiet = { ...createAlert(0), id: "quiet", name: "Quiet" };
    const party = {
      ...createAlert(1),
      id: "party",
      name: "Party",
      media: {
        name: "Party",
        file: "party.png",
        duration: 5,
        volume: 100,
        start: 0,
        end: null,
      },
    };
    const embed = layerOf("overlay", {
      source: { type: "alert", id: "party" },
    });
    const { user } = await open(
      studioOverlay("Main", { id: ID, layers: [embed] }),
    );
    await send(
      APP_EVENTS_RESPONSE.GET_PROFILE,
      profileReply((p) => {
        p.alerts.items = [quiet, party];
      }),
    );

    expect(drawn(embed.id)).toHaveTextContent("Alert: Party");
    await user.click(row(/^Alert: Party/));
    await user.click(field("Overlay").getByText("Alert: Party"));

    expect(screen.queryByText("Alert: Quiet")).not.toBeInTheDocument();
    expect(screen.getAllByText("Countdown timer").length).toBeGreaterThan(0);
  });

  it("says when the overlay server is off", async () => {
    await open(studioOverlay("Main", { id: ID }));

    await send(
      APP_EVENTS_RESPONSE.GET_SETTINGS,
      settingsReply((store) => {
        store.settings.server.enabled = false;
      }),
    );

    expect(page().getByText(/^The overlay server is off\./)).toBeVisible();
  });
});
