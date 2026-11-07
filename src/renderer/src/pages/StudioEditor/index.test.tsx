import {
  StudioElement,
  StudioElementKind,
  StudioElementOf,
  StudioElementSchema,
  StudioGroup,
  StudioItem,
  StudioOverlay,
} from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE, TOKIO_EVENTS } from "@/common/types";
import { newStudioElement, newStudioGroup } from "@/common/util";
import { rotateCursor } from "./helper";
import { createAction } from "@/pages/Games/helper";
import { createAlert } from "@/pages/Alerts/helper";
import {
  gift,
  overlayApp,
  profileReply,
  settingsReply,
  studioOverlay,
  timerReply,
} from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { inList } from "@test/queries";
import { renderApp } from "@test/render";
import {
  createEvent,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ID = "1b4e28ba-2fa1-41d2-883f-0016d3cca427";

const elementOf = <K extends StudioElementKind>(
  kind: K,
  patch: Partial<StudioElementOf<K>> = {},
) =>
  StudioElementSchema.parse({
    ...newStudioElement(kind, "portrait"),
    ...patch,
  });
const text = (patch: Partial<StudioElementOf<"text">> = {}) =>
  elementOf("text", patch);
// A group holding the elements, back to front
const group = (
  name: string,
  elements: StudioElement[] = [],
  patch: Partial<StudioGroup> = {},
): StudioGroup => ({ ...newStudioGroup(name), elements, ...patch });
// The overlay holding these items, back to front
const holding = (...items: StudioItem[]) =>
  studioOverlay("Main", { id: ID, items });
// The overlay with one group holding the elements
const scene = (...elements: StudioElement[]) =>
  studioOverlay("Main", { id: ID, items: [group("Group 1", elements)] });

const studio = (...data: StudioOverlay[]) =>
  send(APP_EVENTS_RESPONSE.STUDIO, { success: true, data });

async function open(
  overlay: StudioOverlay,
  options?: Parameters<typeof renderApp>[1],
) {
  const view = await renderApp(`/tools/studio/${overlay.id}`, options);
  await studio(overlay);
  return view;
}

// The newest overlay sent to be saved
const lastSave = () => sent(APP_EVENTS.SAVE_STUDIO_OVERLAY).at(-1)?.overlay;
const saved = async () => {
  await waitFor(() => expect(lastSave()).toBeDefined());
  return lastSave()!;
};
// The overlay's item there, a group
const groupIn = (overlay: StudioOverlay | undefined, at: number) => {
  const item = overlay?.items[at];
  return item?.kind === "group" ? item : undefined;
};
// The last saved item there, a group
const savedGroup = (at: number) => groupIn(lastSave(), at);
// The first group's first element, as last saved
const savedElement = () => savedGroup(0)?.elements[0];
// Each item's id, a group's with its elements', as last saved
const savedIds = () =>
  lastSave()?.items.map((item) =>
    item.kind === "group"
      ? [item.id, ...item.elements.map((e) => e.id)]
      : item.id,
  );
// The last saved items' names, a group's or an element's label
const savedNames = () =>
  lastSave()?.items.map((item) =>
    item.kind === "group" ? item.name : item.label,
  );

const page = () => within(screen.getByRole("main"));
const layers = () => within(page().getByRole("list", { name: "Elements" }));
const row = (name: RegExp) => layers().getByRole("button", { name });
// The row a group's or an element's select button is in
const rowOf = (name: RegExp) =>
  within(row(name).closest<HTMLElement>("[data-row]")!);
const grip = (id: string) =>
  document.querySelector<HTMLElement>(`[data-grip="${id}"]`)!;
const canvas = () => page().getByLabelText(/^Canvas./);
const drawn = (id: string) =>
  canvas().querySelector<HTMLElement>(`[data-element="${id}"]`)!;
const field = (name: string) => within(page().getByRole("group", { name }));
const addMenu = () =>
  page().getByRole("button", { name: "Add a group or an element" });
const deleteButton = (name: string) => page().getByRole("button", { name });

// The canvas at half size on screen, 540 × 960 from the root's top left
// (jsdom's getBoundingClientRect is all zeros)
function sized() {
  const root = canvas().querySelector<HTMLElement>(".studio-stage")!;
  vi.spyOn(root, "clientWidth", "get").mockReturnValue(540);
  vi.spyOn(root, "clientHeight", "get").mockReturnValue(960);
}
// A corner's resize handle on the canvas
const handle = (corner: string) =>
  canvas().querySelector<HTMLElement>(`[data-handle="${corner}"]`)!;
// A press on the canvas at a point of it, in its px
const press = (x: number, y: number) =>
  fireEvent.pointerDown(canvas(), {
    button: 0,
    clientX: x / 2,
    clientY: y / 2,
  });

describe("StudioEditor", () => {
  beforeEach(() => {
    Element.prototype.setPointerCapture = vi.fn();
  });

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
    expect(page().getByText(/^No elements yet\./)).toBeVisible();
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

  it("adds each kind of element on its own, in front, and selects it", async () => {
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

    await user.click(addMenu());
    expect(screen.getByRole("group", { name: "Add an element" })).toBe(
      screen.getByText("Add an element").parentElement,
    );
    await user.keyboard("{Escape}");
    for (const kind of kinds) {
      // The one just added is selected, so nothing goes into a group
      await user.click(addMenu());
      expect(screen.getByText("Add an element")).toBeVisible();
      await user.click(screen.getByRole("menuitem", { name: kind }));
      expect(page().getByRole("heading", { name: kind })).toBeVisible();
    }

    const overlay = await waitFor(() => {
      const last = lastSave();
      expect(last?.items).toHaveLength(7);
      return last!;
    });
    // No group made for them
    expect(overlay.items.map((item) => item.kind)).toEqual([
      "text",
      "media",
      "gift",
      "emote",
      "shape",
      "viewer",
      "overlay",
    ]);
    // Front on top, with no group around them
    const names = [
      ...layers()
        .getAllByRole("listitem")[0]
        .closest("ul")!
        .querySelectorAll("[class*=layer_name]"),
    ].map((name) => name.textContent);
    expect(names).toEqual([...kinds].reverse());
    // A viewer's picture waits for an event
    expect(overlay.items[5]).toMatchObject({ when: "event" });
  });

  it("adds a new group after the first free number, in front, and selects it", async () => {
    const shape = elementOf("shape");
    const { user } = await open(
      holding(group("Group 1"), shape, group("Group 3")),
    );

    await user.click(addMenu());
    await user.click(screen.getByRole("menuitem", { name: "New group" }));

    await waitFor(() =>
      expect(savedNames()).toEqual(["Group 1", "", "Group 3", "Group 2"]),
    );
    expect(page().getByRole("heading", { name: "Group" })).toBeVisible();
    expect(field("Name").getByRole("textbox")).toHaveValue("Group 2");
    expect(row(/^Group 2/)).toHaveAttribute("aria-pressed", "true");
    // Elements go into it now
    await user.click(addMenu());
    expect(screen.getByText("Add to Group 2")).toBeVisible();
  });

  it("adds into the selected group, or the selected element's", async () => {
    const back = group("Back", [text({ text: "In back" })]);
    const front = group("Front");
    const { user } = await open(holding(back, front));

    await user.click(row(/^Front/));
    await user.click(addMenu());
    expect(screen.getByText("Add to Front")).toBeVisible();
    await user.click(screen.getByRole("menuitem", { name: "Shape" }));
    await waitFor(() =>
      expect(savedGroup(1)?.elements.map((e) => e.kind)).toEqual(["shape"]),
    );
    expect(page().getByRole("heading", { name: "Shape" })).toBeVisible();

    await user.click(row(/^In back/));
    await user.click(addMenu());
    expect(screen.getByText("Add to Back")).toBeVisible();
    await user.click(screen.getByRole("menuitem", { name: "Text" }));

    // In front in its group
    await waitFor(() =>
      expect(savedGroup(0)?.elements.map((e) => e.kind)).toEqual([
        "text",
        "text",
      ]),
    );
    expect(lastSave()?.items).toHaveLength(2);
  });

  it("lists items front on top, each group with its elements under it", async () => {
    const back = group("Back", [text({ text: "B1" }), text({ text: "B2" })]);
    const alone = text({ text: "Alone" });
    const front = group("Front", [text({ text: "F1" }), text({ text: "F2" })]);
    await open(holding(back, alone, front));

    const names = [
      ...layers()
        .getAllByRole("listitem")[0]
        .closest("ul")!
        .querySelectorAll("[class*=layer_name]"),
    ].map((name) => name.textContent);
    expect(names).toEqual(["Front", "F2", "F1", "Alone", "Back", "B2", "B1"]);
    // Each group's elements in their own list, under its row
    const nested = within(layers().getByRole("list", { name: "Front" }));
    expect(nested.getAllByRole("button", { name: /^F\d/ })).toHaveLength(2);
    expect(row(/^Front/)).toHaveTextContent("2 elements");
    // One on its own sits in the top list, in no group's
    expect(row(/^Alone/).closest("ul")).toBe(
      layers().getAllByRole("listitem")[0].closest("ul"),
    );
  });

  it("folds a group, and a pick on the canvas unfolds it", async () => {
    const shape = elementOf("shape", { x: 0, y: 0, width: 100, height: 100 });
    const { user } = await open(scene(shape));

    const fold = rowOf(/^Group 1/).getByRole("button", {
      name: "Elements in this group",
    });
    expect(fold).toHaveAttribute("aria-expanded", "true");
    await user.click(fold);

    await waitFor(() => expect(savedGroup(0)?.folded).toBe(true));
    expect(fold).toHaveAttribute("aria-expanded", "false");
    expect(layers().queryByRole("button", { name: /^Shape/ })).toBeNull();
    // Main's echo, so unfolding it again is a change to save
    await studio(lastSave()!);

    sized();
    press(50, 50);
    fireEvent.pointerUp(canvas());

    await waitFor(() => expect(savedGroup(0)?.folded).toBe(false));
    expect(row(/^Shape/)).toHaveAttribute("aria-pressed", "true");
  });

  it("lets go of the selection on a click in the list past the items", async () => {
    const shape = elementOf("shape");
    const { user } = await open(scene(shape));
    await user.click(row(/^Shape/));
    expect(row(/^Shape/)).toHaveAttribute("aria-pressed", "true");

    // On the group's tray, past its rows, it stays
    await user.click(
      page().getByRole("list", { name: "Group 1" }).closest("li")!,
    );
    expect(row(/^Shape/)).toHaveAttribute("aria-pressed", "true");

    await user.click(page().getByRole("list", { name: "Elements" }));
    expect(row(/^Shape/)).toHaveAttribute("aria-pressed", "false");
    expect(
      page().getByRole("heading", { name: "Overlay settings" }),
    ).toBeVisible();
  });

  it("selects an element from the list or the canvas, and Escape deselects", async () => {
    const back = elementOf("shape", { x: 0, y: 0, width: 400, height: 400 });
    const front = text({ text: "Hello", x: 300, y: 300 });
    const { user } = await open(scene(back, front));

    await user.click(row(/^Hello/));
    expect(page().getByRole("heading", { name: "Text" })).toBeVisible();
    expect(row(/^Hello/)).toHaveAttribute("aria-pressed", "true");

    sized();
    press(100, 100);
    expect(page().getByRole("heading", { name: "Shape" })).toBeVisible();
    expect(canvas()).toHaveFocus();
    // Where they overlap, the front one
    press(350, 350);
    expect(page().getByRole("heading", { name: "Text" })).toBeVisible();

    await user.keyboard("{Escape}");
    expect(
      page().getByRole("heading", { name: "Overlay settings" }),
    ).toBeVisible();
  });

  it("nudges the selected element with the arrows, Shift ten px", async () => {
    const shape = elementOf("shape", { x: 100, y: 200 });
    const { user } = await open(scene(shape));

    await user.click(row(/^Shape/));
    canvas().focus();
    await user.keyboard("{ArrowRight}{ArrowRight}{Shift>}{ArrowDown}{/Shift}");

    await waitFor(() =>
      expect(savedElement()).toMatchObject({ x: 102, y: 210 }),
    );
    expect(drawn(shape.id).style.left).toBe("102px");
    expect(field("X").getByRole("spinbutton")).toHaveValue(102);
  });

  it("drags an element and its corner, in the canvas's px", async () => {
    const shape = elementOf("shape", {
      x: 100,
      y: 200,
      width: 300,
      height: 100,
    });
    await open(scene(shape));
    sized();

    fireEvent.pointerDown(canvas(), { button: 0, clientX: 60, clientY: 110 });
    fireEvent.pointerMove(canvas(), { clientX: 70, clientY: 115.4 });
    fireEvent.pointerUp(canvas());
    fireEvent.pointerDown(handle("se"), {
      button: 0,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(canvas(), { clientX: -200, clientY: -100 });
    fireEvent.pointerUp(canvas());

    await waitFor(() =>
      expect(savedElement()).toMatchObject({
        x: 120,
        y: 211,
        // Never under 1
        width: 1,
        height: 1,
      }),
    );
  });

  it("resizes from any corner, the opposite one kept", async () => {
    const shape = elementOf("shape", {
      x: 100,
      y: 200,
      width: 300,
      height: 100,
    });
    const { user } = await open(scene(shape));
    await user.click(row(/^Shape/));
    sized();

    expect(
      Array.from(canvas().querySelectorAll<HTMLElement>("[data-handle]")).map(
        (h) => h.dataset.handle,
      ),
    ).toEqual(["nw", "ne", "sw", "se", "rotate"]);
    fireEvent.pointerDown(handle("nw"), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(canvas(), { clientX: 10, clientY: 5 });
    fireEvent.pointerUp(canvas());

    await waitFor(() =>
      expect(savedElement()).toMatchObject({
        x: 120,
        y: 210,
        width: 280,
        height: 90,
      }),
    );
  });

  it("rotates an element with its handle, Shift in steps of 15", async () => {
    const shape = elementOf("shape", {
      x: 100,
      y: 200,
      width: 300,
      height: 100,
    });
    const { user } = await open(scene(shape));
    await user.click(row(/^Shape/));
    sized();

    // Its center is at 125, 125 on screen: the pointer goes to its right
    fireEvent.pointerDown(handle("rotate"), {
      button: 0,
      clientX: 125,
      clientY: 75,
    });
    // The rotate cursor stays on the whole canvas while it turns, along the
    // circle at its turn
    expect(canvas().style.cursor).toBe(rotateCursor(0));
    fireEvent.pointerMove(canvas(), { clientX: 225, clientY: 125 });
    await waitFor(() => expect(canvas().style.cursor).toBe(rotateCursor(90)));
    await waitFor(() => expect(savedElement()?.rotation).toBe(90));
    expect(drawn(shape.id).style.transform).toBe("rotate(90deg)");
    expect(
      canvas().querySelector<HTMLElement>("[class*=selection]")!.style
        .transform,
    ).toBe("rotate(90deg)");

    // 50 degrees, snapped to 45
    fireEvent.pointerMove(canvas(), {
      clientX: 125 + 100 * Math.cos((-40 * Math.PI) / 180),
      clientY: 125 + 100 * Math.sin((-40 * Math.PI) / 180),
      shiftKey: true,
    });
    fireEvent.pointerUp(canvas());
    await waitFor(() => expect(savedElement()?.rotation).toBe(45));
    expect(field("Rotation (°)").getByRole("spinbutton")).toHaveValue(45);
    expect(canvas().style.cursor).toBe("");
    expect(handle("rotate").style.cursor).toBe(rotateCursor(45));
  });

  it("shows the move cursor over what a drag moves, and keeps a drag's cursor", async () => {
    const shape = elementOf("shape", {
      x: 100,
      y: 200,
      width: 300,
      height: 100,
    });
    const { user } = await open(scene(shape));
    await user.click(row(/^Shape/));
    sized();

    // Over the shape, at 125, 125 on screen; past it, nothing to move
    fireEvent.pointerMove(canvas(), { clientX: 125, clientY: 125 });
    expect(canvas().style.cursor).toBe("move");
    fireEvent.pointerMove(canvas(), { clientX: 400, clientY: 400 });
    expect(canvas().style.cursor).toBe("");

    // A corner's resize cursor, wherever the pointer goes while it drags
    fireEvent.pointerDown(handle("se"), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(canvas(), { clientX: 300, clientY: 300 });
    expect(canvas().style.cursor).toBe("nwse-resize");
    fireEvent.pointerUp(canvas());
    expect(canvas().style.cursor).not.toBe("nwse-resize");
  });

  it("flips an element from its settings, the canvas drawing it", async () => {
    const shape = elementOf("shape");
    const { user } = await open(scene(shape));
    await user.click(row(/^Shape/));
    const flipX = page().getByRole("button", { name: "Flip horizontally" });
    expect(flipX).toHaveAttribute("aria-pressed", "false");

    await user.click(flipX);
    await waitFor(() =>
      expect(savedElement()).toMatchObject({ flip_x: true, flip_y: false }),
    );
    expect(flipX).toHaveAttribute("aria-pressed", "true");
    expect(drawn(shape.id).style.transform).toBe("scale(-1, 1)");

    await user.click(page().getByRole("button", { name: "Flip vertically" }));
    await waitFor(() =>
      expect(savedElement()).toMatchObject({ flip_x: true, flip_y: true }),
    );
    expect(drawn(shape.id).style.transform).toBe("scale(-1, -1)");
  });

  it("aligns an element to the canvas's edges and middles", async () => {
    const shape = elementOf("shape", {
      x: 100,
      y: 200,
      width: 300,
      height: 100,
    });
    const { user } = await open(scene(shape));
    await user.click(row(/^Shape/));
    const align = within(
      page().getByRole("group", { name: "Align to the canvas" }),
    );

    await user.click(align.getByRole("button", { name: "Align right" }));
    await waitFor(() =>
      expect(savedElement()).toMatchObject({ x: 780, y: 200 }),
    );
    await user.click(align.getByRole("button", { name: "Center vertically" }));
    await waitFor(() =>
      expect(savedElement()).toMatchObject({ x: 780, y: 910 }),
    );
    expect(field("X").getByRole("spinbutton")).toHaveValue(780);
  });

  it("sets the rotation by number", async () => {
    const shape = elementOf("shape");
    const { user } = await open(scene(shape));
    await user.click(row(/^Shape/));

    const input = field("Rotation (°)").getByRole("spinbutton");
    await user.clear(input);
    await user.type(input, "-30");

    await waitFor(() => expect(savedElement()?.rotation).toBe(-30));
  });

  it("links the width and the height, a dragged field keeping their proportions", async () => {
    const shape = elementOf("shape", { width: 200, height: 150 });
    const { user } = await open(scene(shape));
    await user.click(row(/^Shape/));
    const link = page().getByRole("button", { name: "Link width and height" });
    const width = field("Width").getByRole("spinbutton");

    await user.click(link);
    expect(link).toHaveAttribute("aria-pressed", "true");
    await user.clear(width);
    await user.type(width, "400");
    await waitFor(() =>
      expect(savedElement()).toMatchObject({ width: 400, height: 300 }),
    );
    await user.tab();

    // A px at a time, from the proportions it had, not each step's rounding
    fireEvent.pointerDown(width, { button: 0, clientX: 0 });
    for (let x = 1; x <= 101; x++) fireEvent.pointerMove(width, { clientX: x });
    fireEvent.pointerUp(width);
    await waitFor(() =>
      expect(savedElement()).toMatchObject({ width: 501, height: 376 }),
    );

    await user.click(link);
    await user.clear(width);
    await user.type(width, "100");
    await waitFor(() =>
      expect(savedElement()).toMatchObject({ width: 100, height: 376 }),
    );
  });

  it("keeps the proportions on the canvas's corners while linked", async () => {
    const shape = elementOf("shape", {
      x: 100,
      y: 200,
      width: 300,
      height: 100,
    });
    const { user } = await open(scene(shape));
    await user.click(row(/^Shape/));
    await user.click(
      page().getByRole("button", { name: "Link width and height" }),
    );
    sized();

    fireEvent.pointerDown(handle("se"), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(canvas(), { clientX: 15, clientY: 0 });
    fireEvent.pointerUp(canvas());

    await waitFor(() =>
      expect(savedElement()).toMatchObject({
        x: 100,
        y: 200,
        width: 327,
        height: 109,
      }),
    );
  });

  it("locks an element: a click goes through it, and its row says so", async () => {
    const back = elementOf("shape", { x: 0, y: 0, width: 400, height: 400 });
    const front = text({ text: "Hello", x: 0, y: 0, width: 400, height: 400 });
    const { user } = await open(scene(back, front));
    sized();

    await user.click(
      rowOf(/^Hello/).getByRole("button", { name: "Lock element" }),
    );
    await waitFor(() => expect(savedGroup(0)?.elements[1].locked).toBe(true));
    expect(
      rowOf(/^Hello/).getByRole("button", { name: "Lock element" }),
    ).toHaveAttribute("aria-pressed", "true");

    press(100, 100);
    expect(page().getByRole("heading", { name: "Shape" })).toBeVisible();

    // Picked from the list, it has no handles
    await user.click(row(/^Hello/));
    expect(canvas().querySelector("[data-handle]")).toBeNull();
  });

  it("hides an element from the canvas, its eye pressed", async () => {
    const shape = elementOf("shape");
    const { user } = await open(scene(shape));

    await user.click(
      rowOf(/^Shape/).getByRole("button", { name: "Hide element" }),
    );

    await waitFor(() => expect(savedElement()?.hidden).toBe(true));
    expect(drawn(shape.id)).toBeNull();
    expect(
      rowOf(/^Shape/).getByRole("button", { name: "Hide element" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps a text's box as tall as its words", async () => {
    const words = text({
      text: "Hello This is a test aaaaaaaaaaaaaaaaaa",
      x: 100,
      y: 200,
      width: 600,
      height: 300,
    });
    const { user } = await open(scene(words));
    await user.click(row(/^Hello/));
    sized();
    // Two lines, 60 px on screen at half size
    const measured = vi
      .spyOn(Range.prototype, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(0, 0, 300, 60));

    fireEvent.pointerDown(handle("se"), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(canvas(), { clientX: 0, clientY: -500 });
    fireEvent.pointerUp(canvas());
    await waitFor(() =>
      expect(savedElement()).toMatchObject({ y: 200, height: 120 }),
    );

    // From the top it stops there too, its bottom kept
    fireEvent.pointerDown(handle("nw"), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(canvas(), { clientX: 0, clientY: 500 });
    fireEvent.pointerUp(canvas());
    await waitFor(() =>
      expect(savedElement()).toMatchObject({ y: 200, height: 120 }),
    );
    expect(measured).toHaveBeenCalled();
  });

  it("keeps a text's box as wide as its longest word", async () => {
    const words = text({
      text: "Hello This is a test aaaaaaaaaaaaaaaaaa",
      x: 100,
      y: 200,
      width: 600,
      height: 300,
    });
    const { user } = await open(scene(words));
    await user.click(row(/^Hello/));
    sized();
    const shown = drawn(words.id).querySelector<HTMLElement>(".studio-text")!;
    // Its longest word, 150 px on screen at half size, measured as narrow
    // as the words let it be, with no word broken
    const asked: string[] = [];
    vi.spyOn(shown, "getBoundingClientRect").mockImplementation(() => {
      asked.push(`${shown.style.width} ${shown.style.overflowWrap}`);
      return new DOMRect(0, 0, 150, 30);
    });

    fireEvent.pointerDown(handle("se"), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(canvas(), { clientX: -500, clientY: 0 });
    fireEvent.pointerUp(canvas());

    await waitFor(() =>
      expect(savedElement()).toMatchObject({
        x: 100,
        y: 200,
        width: 300,
        height: 300,
      }),
    );
    // Each time as narrow as its words let it be, no word broken
    expect(new Set(asked)).toEqual(new Set(["min-content normal"]));
    // Put back for the stream's own wrapping
    expect(shown.style.width).toBe("");
    expect(shown.style.overflowWrap).toBe("");
  });

  it("grows a text's box to its words when its size changes", async () => {
    const words = text({
      text: "Hello",
      align: "center",
      x: 100,
      y: 200,
      width: 300,
      height: 100,
    });
    const { user } = await open(scene(words));
    await user.click(row(/^Hello/));
    sized();
    // At half size on screen: its longest word 200 px, its lines 120 px tall
    const shown = drawn(words.id).querySelector<HTMLElement>(".studio-text")!;
    vi.spyOn(shown, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 200, 60),
    );
    vi.spyOn(Range.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 200, 120),
    );

    const size = field("Size").getByRole("spinbutton");
    await user.clear(size);
    await user.type(size, "200");
    // Around its middle, as it's centered
    await waitFor(() =>
      expect(savedElement()).toMatchObject({
        size: 200,
        x: 50,
        y: 130,
        width: 400,
        height: 240,
      }),
    );
  });

  it("keeps a text's box fields to its words, its height following its width", async () => {
    const words = text({
      text: "Hello there",
      x: 100,
      y: 200,
      width: 600,
      height: 300,
    });
    const { user } = await open(scene(words));
    sized();
    // At half size on screen: its longest word 150 px, and its words 200 px
    // tall in a box under 400 px of the canvas, 100 px in a wider one
    const node = drawn(words.id);
    vi.spyOn(
      node.querySelector<HTMLElement>(".studio-text")!,
      "getBoundingClientRect",
    ).mockReturnValue(new DOMRect(0, 0, 150, 30));
    vi.spyOn(Range.prototype, "getBoundingClientRect").mockImplementation(
      () => {
        const at = parseFloat(node.style.width);
        return new DOMRect(0, 0, at / 2, at < 400 ? 200 : 100);
      },
    );
    await user.click(row(/^Hello/));
    const width = field("Width").getByRole("spinbutton");
    const height = field("Height").getByRole("spinbutton");

    // Stopped at its longest word, taller there for its words
    fireEvent.pointerDown(width, { button: 0, clientX: 0 });
    fireEvent.pointerMove(width, { clientX: -400 });
    await waitFor(() =>
      expect(savedElement()).toMatchObject({ width: 300, height: 400 }),
    );
    await studio(lastSave()!);
    // Wide again, the height it had before
    fireEvent.pointerMove(width, { clientX: -100 });
    fireEvent.pointerUp(width);
    await waitFor(() =>
      expect(savedElement()).toMatchObject({ width: 600, height: 300 }),
    );

    // Under its words' 200 px, a typed height isn't taken
    await user.clear(height);
    await user.type(height, "150");
    await user.tab();
    expect(height).toHaveValue(300);
    expect(savedElement()?.height).toBe(300);
  });

  it("resizes, turns, flips and fades a group from its fields", async () => {
    const big = elementOf("shape", { x: 100, y: 100, width: 100, height: 100 });
    const small = elementOf("shape", {
      x: 300,
      y: 300,
      width: 100,
      height: 100,
    });
    const { user } = await open(scene(big, small));
    await user.click(row(/^Group 1/));
    const elements = () => lastSave()!.items[0];
    const typeInto = async (name: string, value: string) => {
      const input = field(name).getByRole("spinbutton");
      await user.clear(input);
      await user.type(input, value);
    };

    // The frame: 100, 100, 300 by 300
    expect(field("Width").getByRole("spinbutton")).toHaveValue(300);
    await typeInto("Width", "600");
    await waitFor(() =>
      expect(elements()).toMatchObject({
        elements: [
          { x: 100, width: 200 },
          { x: 500, width: 200 },
        ],
      }),
    );
    await studio(lastSave()!);

    await user.click(page().getByRole("button", { name: "Flip horizontally" }));
    await waitFor(() =>
      expect(elements()).toMatchObject({
        flip_x: true,
        elements: [
          { x: 500, flip_x: true },
          { x: 100, flip_x: true },
        ],
      }),
    );
    await studio(lastSave()!);

    await user.click(page().getByRole("button", { name: "Align left" }));
    await waitFor(() =>
      expect(elements()).toMatchObject({
        elements: [{ x: 400 }, { x: 0 }],
      }),
    );
  });

  it("drags a group's width from its field, its elements scaling as one", async () => {
    const big = elementOf("shape", { x: 100, y: 100, width: 100, height: 100 });
    const small = elementOf("shape", {
      x: 300,
      y: 300,
      width: 100,
      height: 100,
    });
    // As in development, where React runs each state update twice
    const { user } = await open(scene(big, small), { reactStrictMode: true });
    await user.click(row(/^Group 1/));
    const width = field("Width").getByRole("spinbutton");

    // From 300 to 150 a px at a time: each step from where it began, so the
    // elements' rounding doesn't stall them
    fireEvent.pointerDown(width, { button: 0, clientX: 0 });
    for (let x = 1; x <= 150; x++)
      fireEvent.pointerMove(width, { clientX: -x });
    fireEvent.pointerUp(width);

    await waitFor(() =>
      expect(savedGroup(0)?.elements).toMatchObject([
        { x: 100, width: 50, height: 100 },
        { x: 200, width: 50, height: 100 },
      ]),
    );
    expect(width).toHaveValue(150);
  });

  it("turns a group by its handle as far as the pointer, step after step", async () => {
    const big = elementOf("shape", { x: 100, y: 100, width: 100, height: 100 });
    const small = elementOf("shape", {
      x: 300,
      y: 300,
      width: 100,
      height: 100,
    });
    // As in development, where React runs each state update twice
    const { user } = await open(scene(big, small), { reactStrictMode: true });
    await user.click(row(/^Group 1/));
    sized();

    // Its frame's middle is at 125, 125 on screen: the pointer goes around
    // it clockwise from above, to 30, 60, then 90 degrees
    fireEvent.pointerDown(handle("rotate"), {
      button: 0,
      clientX: 125,
      clientY: 25,
    });
    for (const degrees of [30, 60, 90]) {
      const rad = (degrees * Math.PI) / 180;
      fireEvent.pointerMove(canvas(), {
        clientX: 125 + 100 * Math.sin(rad),
        clientY: 125 - 100 * Math.cos(rad),
      });
    }
    fireEvent.pointerUp(canvas());

    // A quarter turn around 250, 250 of the canvas
    await waitFor(() =>
      expect(savedGroup(0)).toMatchObject({
        rotation: 90,
        elements: [
          { x: 300, y: 100, rotation: 90 },
          { x: 100, y: 300, rotation: 90 },
        ],
      }),
    );
  });

  it("moves a selected group's elements as one, and a click without moving picks", async () => {
    const big = elementOf("shape", { x: 100, y: 100, width: 100, height: 100 });
    const small = elementOf("shape", { x: 300, y: 300, width: 50, height: 50 });
    const { user } = await open(scene(big, small));
    await user.click(row(/^Group 1/));
    expect(page().getByRole("heading", { name: "Group" })).toBeVisible();
    // Its frame resizes and turns like an element
    expect(
      Array.from(canvas().querySelectorAll<HTMLElement>("[data-handle]")).map(
        (h) => h.dataset.handle,
      ),
    ).toEqual(["nw", "ne", "sw", "se", "rotate"]);
    sized();

    // Inside the outline, between the two
    press(250, 250);
    // Under 3 screen px, nothing yet
    fireEvent.pointerMove(canvas(), { clientX: 126, clientY: 126 });
    fireEvent.pointerMove(canvas(), { clientX: 135, clientY: 130.2 });
    fireEvent.pointerUp(canvas());

    await waitFor(() =>
      expect(savedGroup(0)?.elements).toMatchObject([
        { x: 120, y: 110, width: 100, height: 100 },
        { x: 320, y: 310, width: 50, height: 50 },
      ]),
    );
    expect(page().getByRole("heading", { name: "Group" })).toBeVisible();

    canvas().focus();
    await user.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    await waitFor(() =>
      expect(savedGroup(0)?.elements).toMatchObject([
        { x: 110, y: 110 },
        { x: 310, y: 310 },
      ]),
    );

    // A click inside the outline, on the small one
    press(320, 320);
    fireEvent.pointerUp(canvas());
    expect(page().getByRole("heading", { name: "Shape" })).toBeVisible();
    expect(
      layers().getAllByRole("button", { name: /^Shape/ })[0],
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("drags, resizes and nudges a selected element on its own as an element", async () => {
    const shape = elementOf("shape", {
      x: 100,
      y: 200,
      width: 300,
      height: 100,
    });
    const { user } = await open(holding(shape));
    await user.click(row(/^Shape/));
    expect(page().getByRole("heading", { name: "Shape" })).toBeVisible();
    sized();
    // Its own handles, not a group's bare outline
    expect(handle("se")).not.toBeNull();

    // A press inside its box drags it, with no 3 px wait
    press(150, 250);
    fireEvent.pointerMove(canvas(), { clientX: 76, clientY: 125 });
    fireEvent.pointerUp(canvas());
    await waitFor(() =>
      expect(lastSave()?.items[0]).toMatchObject({ x: 102, y: 200 }),
    );

    fireEvent.pointerDown(handle("se"), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(canvas(), { clientX: 10, clientY: 5 });
    fireEvent.pointerUp(canvas());
    await waitFor(() =>
      expect(lastSave()?.items[0]).toMatchObject({
        x: 102,
        y: 200,
        width: 320,
        height: 110,
      }),
    );

    canvas().focus();
    await user.keyboard("{ArrowDown}");
    await waitFor(() =>
      expect(lastSave()?.items[0]).toMatchObject({ y: 201, width: 320 }),
    );
    expect(page().getByRole("heading", { name: "Shape" })).toBeVisible();
  });

  it("locks and hides an element on its own", async () => {
    const under = text({ text: "Under", x: 0, y: 0, width: 500, height: 500 });
    const top = elementOf("shape", { x: 0, y: 0, width: 500, height: 500 });
    const { user } = await open(holding(group("Back", [under]), top));

    const lock = rowOf(/^Shape/).getByRole("button", { name: "Lock element" });
    await user.click(lock);
    await waitFor(() =>
      expect(lastSave()?.items[1]).toMatchObject({ locked: true }),
    );
    expect(lock).toHaveAttribute("aria-pressed", "true");

    // Through to what's under it
    sized();
    press(100, 100);
    fireEvent.pointerUp(canvas());
    expect(page().getByRole("heading", { name: "Text" })).toBeVisible();

    // Picked from the list, it keeps still
    await user.click(row(/^Shape/));
    expect(canvas().querySelector("[data-handle]")).toBeNull();
    canvas().focus();
    await user.keyboard("{ArrowRight}");
    expect(field("X").getByRole("spinbutton")).toHaveValue(0);

    const eye = rowOf(/^Shape/).getByRole("button", { name: "Hide element" });
    await user.click(eye);
    await waitFor(() =>
      expect(lastSave()?.items[1]).toMatchObject({ hidden: true }),
    );
    expect(eye).toHaveAttribute("aria-pressed", "true");
    expect(drawn(top.id)).toBeNull();
    expect(drawn(under.id)).not.toBeNull();
  });

  it("locks a group: the canvas skips it, and the list and settings still change it", async () => {
    const under = text({ text: "Under", x: 0, y: 0, width: 500, height: 500 });
    const top = elementOf("shape", { x: 0, y: 0, width: 500, height: 500 });
    const { user } = await open(
      holding(group("Back", [under]), group("Front", [top])),
    );

    const lock = rowOf(/^Front/).getByRole("button", { name: "Lock group" });
    expect(lock).toHaveAttribute("aria-pressed", "false");
    await user.click(lock);
    await waitFor(() => expect(savedGroup(1)?.locked).toBe(true));
    expect(lock).toHaveAttribute("aria-pressed", "true");

    // Through to what's under it
    sized();
    press(100, 100);
    fireEvent.pointerUp(canvas());
    expect(page().getByRole("heading", { name: "Text" })).toBeVisible();

    // Its outline shows, without the handle, and nothing moves it
    await user.click(row(/^Shape/));
    expect(canvas().querySelector("[class*=selection]")).not.toBeNull();
    expect(canvas().querySelector("[data-handle]")).toBeNull();
    canvas().focus();
    await user.keyboard("{ArrowRight}");
    expect(field("X").getByRole("spinbutton")).toHaveValue(0);

    const x = field("X").getByRole("spinbutton");
    await user.clear(x);
    await user.type(x, "40");
    await waitFor(() =>
      expect(savedGroup(1)?.elements[0]).toMatchObject({ x: 40 }),
    );
  });

  it("hides a group from the canvas", async () => {
    const shape = elementOf("shape");
    const { user } = await open(scene(shape));

    const eye = rowOf(/^Group 1/).getByRole("button", { name: "Hide group" });
    await user.click(eye);

    await waitFor(() => expect(savedGroup(0)?.hidden).toBe(true));
    expect(eye).toHaveAttribute("aria-pressed", "true");
    expect(drawn(shape.id)).toBeNull();
  });

  it("steps a group past the item in front from the keyboard, up the list", async () => {
    const back = group("Back", [text({ text: "B" })]);
    const alone = text({ text: "Alone" });
    const front = group("Front", [text({ text: "F" })]);
    const { user } = await open(holding(back, alone, front));

    grip(back.id).focus();
    await user.keyboard("{ArrowUp}");
    await waitFor(() =>
      expect(lastSave()?.items.map((i) => i.id)).toEqual([
        alone.id,
        back.id,
        front.id,
      ]),
    );
    expect(grip(back.id)).toHaveFocus();

    // Past a whole group, not into it
    await user.keyboard("{ArrowUp}");
    await waitFor(() =>
      expect(lastSave()?.items.map((i) => i.id)).toEqual([
        alone.id,
        front.id,
        back.id,
      ]),
    );
    expect(
      canvas().querySelector<HTMLElement>(`[data-layer="${back.id}"]`)!.style
        .zIndex,
    ).toBe("2");
    expect(grip(back.id)).toHaveFocus();
  });

  it("moves an element out of its group and into the next from the keyboard", async () => {
    const a = text({ text: "A" });
    const b = text({ text: "B" });
    const back = group("Back", [a]);
    const front = group("Front", [b], { folded: true });
    const { user } = await open(holding(back, front));

    grip(a.id).focus();
    // Out of its group, right in front of it
    await user.keyboard("{ArrowUp}");
    await waitFor(() =>
      expect(savedIds()).toEqual([[back.id], a.id, [front.id, b.id]]),
    );
    expect(grip(a.id)).toHaveFocus();

    // Into the group in front, at its back, which unfolds
    await user.keyboard("{ArrowUp}");
    await waitFor(() =>
      expect(savedIds()).toEqual([[back.id], [front.id, a.id, b.id]]),
    );
    expect(savedGroup(1)?.folded).toBe(false);
    expect(grip(a.id)).toHaveFocus();

    // And back down: out, then into the group behind, in front in it
    await user.keyboard("{ArrowDown}{ArrowDown}");
    await waitFor(() =>
      expect(savedIds()).toEqual([
        [back.id, a.id],
        [front.id, b.id],
      ]),
    );
    expect(grip(a.id)).toHaveFocus();
  });

  it("drops an element into a group, next to another element, or on its own", async () => {
    const x = text({ text: "X" });
    const a = text({ text: "A" });
    const b = text({ text: "B" });
    const alone = text({ text: "Alone" });
    const back = group("Back", [x], { folded: true });
    const front = group("Front", [a, b]);
    await open(holding(back, alone, front));
    const dataTransfer = { setDragImage: vi.fn() };
    const drop = (id: string, on: HTMLElement, clientY = 0) => {
      fireEvent.dragStart(grip(id), { dataTransfer });
      // jsdom has no DragEvent, so the pointer's height goes on by hand
      const over = createEvent.dragOver(on, { dataTransfer });
      Object.defineProperty(over, "clientY", { value: clientY });
      fireEvent(on, over);
      fireEvent.drop(on, { dataTransfer });
      fireEvent.dragEnd(grip(id), { dataTransfer });
    };
    const rowEl = (name: RegExp) =>
      row(name).closest<HTMLElement>("[data-row]")!;

    // Onto a group's row: in front in it, and it unfolds
    drop(a.id, rowEl(/^Back/));
    await waitFor(() =>
      expect(savedIds()).toEqual([
        [back.id, x.id, a.id],
        alone.id,
        [front.id, b.id],
      ]),
    );
    expect(savedGroup(0)?.folded).toBe(false);

    // Up the list onto an element in a group: in front of it
    drop(x.id, rowEl(/^B Text/));
    await waitFor(() =>
      expect(savedIds()).toEqual([
        [back.id, a.id],
        alone.id,
        [front.id, b.id, x.id],
      ]),
    );

    // Down the list onto an element on its own: behind it, on its own too
    drop(x.id, rowEl(/^Alone/));
    await waitFor(() =>
      expect(savedIds()).toEqual([
        [back.id, a.id],
        x.id,
        alone.id,
        [front.id, b.id],
      ]),
    );

    // The top quarter of a group's row: in front of the group, on its own
    vi.spyOn(rowEl(/^Back/), "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 100, 200, 40),
    );
    drop(a.id, rowEl(/^Back/), 105);
    await waitFor(() =>
      expect(savedIds()).toEqual([
        [back.id],
        a.id,
        x.id,
        alone.id,
        [front.id, b.id],
      ]),
    );
  });

  it("drags an element out of its group, between items or past the last", async () => {
    const a = text({ text: "A" });
    const b = text({ text: "B" });
    const c = text({ text: "C" });
    const back = group("Back", [a]);
    const front = group("Front", [b, c]);
    await open(holding(back, front));
    const dataTransfer = { setDragImage: vi.fn() };
    const list = page().getByRole("list", { name: "Elements" });
    // Off the rows, on the list itself
    const drop = (id: string, clientY: number) => {
      fireEvent.dragStart(grip(id), { dataTransfer });
      const over = createEvent.dragOver(list, { dataTransfer });
      Object.defineProperty(over, "clientY", { value: clientY });
      fireEvent(list, over);
      fireEvent.drop(list, { dataTransfer });
      fireEvent.dragEnd(grip(id), { dataTransfer });
    };
    // On screen, front on top: Front's tray from 0 to 100, Back's from 108
    const item = (id: string) =>
      list.querySelector<HTMLElement>(`[data-item="${id}"]`)!;
    vi.spyOn(item(front.id), "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 300, 100),
    );
    vi.spyOn(item(back.id), "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 108, 300, 52),
    );

    // Under the last item: on its own, at the back
    drop(c.id, 400);
    await waitFor(() =>
      expect(savedIds()).toEqual([c.id, [back.id, a.id], [front.id, b.id]]),
    );

    // In the gap between the groups: on its own, in front of Back
    drop(b.id, 104);
    await waitFor(() =>
      expect(savedIds()).toEqual([c.id, [back.id, a.id], b.id, [front.id]]),
    );
  });

  it("drops a group only between items, not into another", async () => {
    const a = text({ text: "A" });
    const alone = text({ text: "Alone" });
    const back = group("Back", [a]);
    const front = group("Front", [text({ text: "F" })]);
    await open(holding(back, alone, front));
    const dataTransfer = { setDragImage: vi.fn() };

    // Onto an element in a group: the group's place
    fireEvent.dragStart(grip(back.id), { dataTransfer });
    const on = row(/^F Text/).closest<HTMLElement>("[data-row]")!;
    fireEvent.dragOver(on, { dataTransfer });
    fireEvent.drop(on, { dataTransfer });
    fireEvent.dragEnd(grip(back.id), { dataTransfer });

    await waitFor(() =>
      expect(lastSave()?.items.map((i) => i.id)).toEqual([
        alone.id,
        front.id,
        back.id,
      ]),
    );
    expect(savedGroup(2)?.elements.map((e) => e.id)).toEqual([a.id]);
  });

  it("deletes an element, an empty group at once, and a full one once confirmed", async () => {
    const a = text({ text: "A" });
    const b = text({ text: "B" });
    const c = elementOf("shape");
    const alone = elementOf("emote");
    const full = group("Full", [a, b]);
    const empty = group("Empty");
    const { user } = await open(
      holding(full, empty, group("Last", [c]), alone),
    );
    expect(
      deleteButton("Select a group or an element to delete it"),
    ).toBeDisabled();

    await user.click(row(/^Shape/));
    await user.click(deleteButton("Delete element"));
    await waitFor(() => expect(savedGroup(2)?.elements).toEqual([]));
    expect(drawn(c.id)).toBeNull();

    // On its own, at once too
    await user.click(row(/^Emote/));
    await user.click(deleteButton("Delete element"));
    await waitFor(() => expect(lastSave()?.items).toHaveLength(3));

    await user.click(row(/^Empty/));
    await user.click(deleteButton("Delete group"));
    await waitFor(() => expect(lastSave()?.items).toHaveLength(2));

    await user.click(row(/^Full/));
    await user.click(deleteButton("Delete group"));
    const dialog = within(
      screen.getByRole("dialog", { name: "Delete group?" }),
    );
    expect(
      dialog.getByText(
        "Full and the 2 elements in it will be deleted. There's no undo.",
      ),
    ).toBeVisible();
    await user.click(dialog.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(savedNames()).toEqual(["Last"]));
    expect(drawn(a.id)).toBeNull();
  });

  it("names a group in its settings", async () => {
    const { user } = await open(scene(elementOf("shape")));

    await user.click(row(/^Group 1/));
    const name = field("Name").getByRole("textbox");
    await user.clear(name);

    await waitFor(() => expect(savedGroup(0)?.name).toBe(""));
    expect(row(/^Untitled group/)).toBeVisible();
    expect(name).toHaveAttribute("placeholder", "Untitled group");
    await user.type(name, "Intro");
    await waitFor(() => expect(savedGroup(0)?.name).toBe("Intro"));
  });

  it("names an element, its row showing the name or else what it shows", async () => {
    const hello = text({ text: "Hello" });
    const { user } = await open(holding(hello));

    await user.click(row(/^Hello/));
    const name = field("Name").getByRole("textbox");
    expect(name).toHaveValue("");
    expect(name).toHaveAttribute("placeholder", "Hello");
    await user.type(name, " Welcome ");

    // Kept as typed, and shown at once
    await waitFor(() =>
      expect(lastSave()?.items[0]).toMatchObject({ label: " Welcome " }),
    );
    expect(row(/^Welcome/)).toHaveAttribute("aria-pressed", "true");
    expect(layers().queryByRole("button", { name: /^Hello/ })).toBeNull();

    // Blank, it's what it shows again
    await user.clear(name);
    await user.type(name, "  ");
    await waitFor(() =>
      expect(lastSave()?.items[0]).toMatchObject({ label: "  " }),
    );
    expect(row(/^Hello/)).toBeVisible();
  });

  it("fills a text's numbers with samples, and saves its text", async () => {
    const element = text({ text: "{likes} likes" });
    const { user } = await open(scene(element));

    expect(drawn(element.id)).toHaveTextContent("12.8K likes");

    await user.click(row(/likes/));
    await user.click(page().getByTitle("Insert {viewers}"));

    expect(groupIn(await saved(), 0)!.elements[0]).toMatchObject({
      text: "{likes} likes{viewers}",
    });
  });

  it("lists the LIVE numbers, then the event's variables while it reacts", async () => {
    const element = text({ text: "Welcome" });
    const { user } = await open(scene(element));
    await user.click(row(/^Welcome/));
    const rowOf = (label: string) =>
      within(page().getByText(label).closest("p")!);

    expect(rowOf("LIVE numbers:").getByTitle("Insert {likes}")).toBeVisible();
    expect(page().queryByText("From the event:")).toBeNull();

    await user.click(page().getByRole("radio", { name: "Shows on an event" }));
    const event = rowOf("From the event:");
    expect(event.getByTitle("Insert {username}")).toBeVisible();
    expect(event.queryByTitle("Insert {likes}")).toBeNull();
    expect(rowOf("LIVE numbers:").queryByTitle("Insert {username}")).toBeNull();

    // Like's come from every viewer: nothing of the event's to say
    const trigger = page().getByRole("group", { name: "Trigger" });
    await user.click(within(trigger).getByText("Follow"));
    await user.click(inList(trigger, "Like")!);
    expect(page().getByText("This event has no variables.")).toBeVisible();
  });

  it("makes an element show on an event, with its trigger, seconds and entrance", async () => {
    const element = text({ text: "Thanks {username}" });
    const { user } = await open(scene(element));
    await user.click(row(/^Thanks/));

    await user.click(page().getByRole("radio", { name: "Shows on an event" }));
    // A sample viewer's name
    expect(drawn(element.id)).not.toHaveTextContent("{username}");
    expect(drawn(element.id).className).toMatch(/studio-waits/);
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
      expect(savedElement()).toMatchObject({
        when: "event",
        trigger: { type: TOKIO_EVENTS.LIKE },
        likes_every: 50,
      }),
    );
    expect(field("Seconds on screen").getByRole("spinbutton")).toHaveValue(5);
  });

  it("offers a viewer's picture only the events a viewer sends", async () => {
    const { user } = await open(scene(elementOf("viewer")));
    await user.click(row(/^Viewer's picture/));

    const trigger = page().getByRole("group", { name: "Trigger" });
    await user.click(within(trigger).getByText("Follow"));

    expect(inList(trigger, "Gift")).not.toBeNull();
    expect(inList(trigger, "Envelope")).toBeNull();
    expect(inList(trigger, "Super Fan Box")).toBeNull();
    expect(inList(trigger, "Music change")).toBeNull();
  });

  it("shows the gift a viewer sends, or one picked", async () => {
    const element = elementOf("gift");
    const { user } = await open(scene(element));
    await send(APP_EVENTS_RESPONSE.GET_GIFTS, {
      data: [gift(5655, "Rose")],
    });
    await user.click(row(/^Gift/));

    const sent = page().getByRole("radio", { name: "The gift a viewer sends" });
    expect(sent).toBeChecked();
    // A sample's gift, while the editor waits for a real one
    expect(drawn(element.id).querySelector("img")?.getAttribute("src")).toMatch(
      /^https:/,
    );

    await user.click(page().getByRole("radio", { name: "A gift you pick" }));
    await waitFor(() => expect(savedElement()).toMatchObject({ gift: 5655 }));
    // Main's echo, so going back to the start is a change to save
    await studio(lastSave()!);

    await user.click(
      page().getByRole("radio", { name: "The gift a viewer sends" }),
    );
    await waitFor(() =>
      expect(savedElement()).toMatchObject({
        gift: null,
        when: "event",
        trigger: { type: TOKIO_EVENTS.GIFT },
      }),
    );
    expect(
      page().queryByRole("radio", { name: "Always on screen" }),
    ).not.toBeInTheDocument();
  });

  it("shows the emote a viewer sends, or one picked from the saved ones", async () => {
    const element = elementOf("emote");
    const { user } = await open(scene(element));
    await user.click(row(/^Emote/));

    // None saved yet: nothing to pick
    expect(
      page().getByRole("radio", { name: "The emote a viewer sends" }),
    ).toBeChecked();
    expect(page().getByText(/once viewers use them/)).toBeVisible();
  });

  it("turns a shape's fill off and a border on", async () => {
    const shape = elementOf("shape");
    const { user } = await open(scene(shape));
    await user.click(row(/^Shape/));

    await user.click(page().getByRole("checkbox", { name: "Fill" }));
    await user.click(page().getByRole("checkbox", { name: "Border" }));
    const width = page().getByRole("spinbutton", { name: "Border width" });
    await user.clear(width);
    await user.type(width, "12");

    await waitFor(() =>
      expect(savedElement()).toMatchObject({
        fill: false,
        border: true,
        border_width: 12,
      }),
    );
    expect(drawn(shape.id).style.getPropertyValue("--studio-border")).toMatch(
      /^12px solid/,
    );
  });

  it("offers a viewer's picture only the event Whens", async () => {
    const { user } = await open(scene(elementOf("viewer")));

    await user.click(row(/^Viewer's picture/));

    expect(
      page().queryByRole("radio", { name: "Always on screen" }),
    ).not.toBeInTheDocument();
    expect(
      page().getByRole("radio", { name: "Shows on an event" }),
    ).toBeChecked();
  });

  it("tests: saves what's waiting, plays the event elements and asks main to", async () => {
    const shows = text({ text: "Hi {username}", when: "event" });
    const always = text({ text: "Always" });
    const other = text({ text: "Other", when: "event" });
    const { user } = await open(
      studioOverlay("Main", {
        id: ID,
        items: [group("Group 1", [shows, always]), group("Group 2", [other])],
      }),
    );
    await user.click(row(/^Always/));
    await user.type(field("Text").getByRole("textbox"), "!");

    await user.click(
      page().getByRole("button", {
        name: "Test the elements that react to events",
      }),
    );

    expect(savedGroup(0)?.elements[1]).toMatchObject({
      text: "Always!",
    });
    expect(sent(APP_EVENTS.TEST_STUDIO_OVERLAY)).toEqual([{ id: ID }]);
    for (const reacts of [shows, other]) {
      const body = drawn(reacts.id).querySelector(".studio-body")!;
      expect(body.className).toMatch(/studio-enter-pop/);
    }
    expect(
      drawn(always.id).querySelector(".studio-body")!.className,
    ).not.toMatch(/studio-enter/);
  });

  it("clears a deleted file from its media elements", async () => {
    const media = elementOf("media", { file: "party.png", name: "Party" });
    const { user } = await open(scene(media));
    await user.click(row(/^Party/));

    await send(APP_EVENTS_RESPONSE.ALERT_FILE_REMOVED, {
      field: "media",
      file: "party.png",
    });

    expect(groupIn(await saved(), 0)!.elements[0]).toMatchObject({
      file: "",
      name: "",
    });
    expect(page().getByRole("button", { name: "Pick a file" })).toBeVisible();
  });

  it("takes a browsed file only while its element waits for one", async () => {
    const media = elementOf("media");
    const { user } = await open(scene(media));
    await user.click(row(/^Image or video/));
    await user.click(page().getByRole("button", { name: "Pick a file" }));
    await user.click(screen.getByRole("button", { name: "Browse file..." }));
    const [{ request }] = sent(APP_EVENTS.IMPORT_MEDIA);

    // Another element's reply, and one for a request not made
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

    expect(groupIn(await saved(), 0)!.elements[0]).toMatchObject({
      file: "party.png",
      name: "Party",
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("frames an installed overlay from disk, transparent, and says when it's gone", async () => {
    const jar = elementOf("overlay", {
      source: { type: "installed", id: "gift-jar" },
    });
    const gone = elementOf("overlay", {
      source: { type: "installed", id: "old" },
    });
    await open(scene(jar, gone));

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
    const timer = elementOf("overlay", { source: { type: "timer" } });
    const games = elementOf("overlay", {
      source: { type: "games", column: null },
    });
    await open(scene(timer, games));

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

  it("places one column of the games overlay on its own", async () => {
    const column = elementOf("overlay", {
      source: { type: "games", column: 2 },
    });
    const { user } = await open(scene(column));
    const action = (name: string, n: number) => ({
      ...createAction("bedrock"),
      overlay: { show: true, image: null, event: "", name, column: n },
    });
    await send(
      APP_EVENTS_RESPONSE.GET_PROFILE,
      profileReply((p) => {
        p.games.overlay.columns = 2;
        p.games.actions = [action("TNT rain", 1), action("Creeper party", 2)];
      }),
    );

    // Only its column's rows, as /games/minecraft/2/ draws them
    expect(drawn(column.id)).toHaveTextContent("Creeper party");
    expect(drawn(column.id)).not.toHaveTextContent("TNT rain");

    await user.click(row(/^Games overlay, column 2/));
    await user.click(field("Overlay").getByText("Games overlay, column 2"));
    await user.click(screen.getByText("Games overlay, column 1"));

    await waitFor(() =>
      expect(savedElement()).toMatchObject({
        source: { type: "games", column: 1 },
      }),
    );
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
    const embed = elementOf("overlay", {
      source: { type: "alert", id: "party" },
    });
    const { user } = await open(scene(embed));
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
