// Overlay Studio's editor: undo and redo, zoom, copy and paste, guides and
// sticking, and cropping
import { StudioElementOf, StudioItem, StudioOverlay } from "@/common/schemas";
import { APP_EVENTS_RESPONSE } from "@/common/types";
import { studioOverlay } from "@test/fixtures";
import { send } from "@test/ipc";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ID,
  elementOf,
  text,
  group,
  holding,
  scene,
  studio,
  open,
  lastSave,
  saved,
  groupIn,
  savedGroup,
  savedElement,
  savedIds,
  page,
  layers,
  row,
  canvas,
  drawn,
  field,
  undo,
  redo,
  zoomLevel,
  scroller,
  area,
  sized,
  handle,
  press,
} from "@test/studio";

describe("StudioEditor", () => {
  beforeEach(() => {
    Element.prototype.setPointerCapture = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("undo and redo", () => {
    // setSystemTime moves Date alone, the history's clock
    afterEach(() => {
      vi.useRealTimers();
    });

    it("undoes and redoes from the header and with the keys, Cmd too", async () => {
      const shape = elementOf("shape", { x: 100 });
      const { user } = await open(holding(shape));
      expect(undo()).toBeDisabled();
      expect(redo()).toBeDisabled();

      await user.click(row(/^Rectangle/));
      const x = field("X").getByRole("spinbutton");
      await user.clear(x);
      await user.type(x, "300");
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ x: 300 }),
      );
      await studio(lastSave()!);
      expect(redo()).toBeDisabled();

      // The whole number typed is one step
      await user.click(undo());
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ x: 100 }),
      );
      expect(x).toHaveValue(100);
      expect(undo()).toBeDisabled();
      await studio(lastSave()!);
      await user.click(redo());
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ x: 300 }),
      );
      await studio(lastSave()!);

      // A number field takes the editor's keys, prevented so Electron's
      // Edit menu never sees them
      x.focus();
      expect(fireEvent.keyDown(x, { key: "z", ctrlKey: true })).toBe(false);
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ x: 100 }),
      );
      await studio(lastSave()!);
      expect(
        fireEvent.keyDown(x, { key: "Z", ctrlKey: true, shiftKey: true }),
      ).toBe(false);
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ x: 300 }),
      );
      await studio(lastSave()!);
      fireEvent.keyDown(document.body, { key: "z", metaKey: true });
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ x: 100 }),
      );
      await studio(lastSave()!);
      fireEvent.keyDown(document.body, { key: "y", ctrlKey: true });
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ x: 300 }),
      );
    });

    it("leaves Ctrl+Z to a text field, and takes it on a checkbox", async () => {
      const words = text({ text: "Thanks", bold: false });
      const { user } = await open(holding(words));
      await user.click(row(/^Thanks/));
      const name = field("Name").getByRole("textbox");
      await user.type(name, "Intro");
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ label: "Intro" }),
      );
      await studio(lastSave()!);

      // Its own undo, not the editor's
      expect(fireEvent.keyDown(name, { key: "z", ctrlKey: true })).toBe(true);

      const bold = page().getByRole("checkbox", { name: "Bold" });
      await user.click(bold);
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ bold: true }),
      );
      await studio(lastSave()!);
      expect(fireEvent.keyDown(bold, { key: "z", ctrlKey: true })).toBe(false);
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({
          label: "Intro",
          bold: false,
        }),
      );
    });

    it("takes a whole drag on the canvas as one step, a pause in it too", async () => {
      const shape = elementOf("shape", {
        x: 100,
        y: 100,
        width: 200,
        height: 200,
      });
      // A ref across updates, so under StrictMode too
      const { user } = await open(holding(shape), { reactStrictMode: true });
      sized();

      vi.setSystemTime(10_000);
      press(200, 200);
      fireEvent.pointerMove(canvas(), { clientX: 130, clientY: 100 });
      vi.setSystemTime(12_000);
      fireEvent.pointerMove(canvas(), { clientX: 160, clientY: 110 });
      fireEvent.pointerUp(canvas());
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ x: 220, y: 120 }),
      );
      await studio(lastSave()!);

      await user.click(undo());
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ x: 100, y: 100 }),
      );
      expect(undo()).toBeDisabled();
    });

    it("takes a burst of changes to one field as one step, and a pause or another field as the next", async () => {
      const shape = elementOf("shape", { x: 100, y: 100 });
      const { user } = await open(holding(shape));
      await user.click(row(/^Rectangle/));
      const x = field("X").getByRole("spinbutton");
      const y = field("Y").getByRole("spinbutton");

      vi.setSystemTime(10_000);
      x.focus();
      for (const value of ["2", "25", "250"]) {
        fireEvent.change(x, { target: { value } });
      }
      vi.setSystemTime(10_600);
      fireEvent.change(x, { target: { value: "260" } });
      y.focus();
      fireEvent.change(y, { target: { value: "50" } });
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ x: 260, y: 50 }),
      );
      await studio(lastSave()!);

      for (const was of [
        { x: 260, y: 100 },
        { x: 250, y: 100 },
        { x: 100, y: 100 },
      ]) {
        await user.click(undo());
        await waitFor(() => expect(lastSave()?.items[0]).toMatchObject(was));
        await studio(lastSave()!);
      }
      expect(undo()).toBeDisabled();
    });

    it("drops what Redo would bring back once something else changes", async () => {
      const shape = elementOf("shape", { x: 100, y: 100 });
      const { user } = await open(holding(shape));
      await user.click(row(/^Rectangle/));
      canvas().focus();
      await user.keyboard("{ArrowRight}");
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ x: 101 }),
      );
      await studio(lastSave()!);

      await user.click(undo());
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ x: 100 }),
      );
      expect(redo()).toBeEnabled();
      canvas().focus();
      await user.keyboard("{ArrowDown}");
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ x: 100, y: 101 }),
      );
      expect(redo()).toBeDisabled();
    });

    it("leaves a group folded as it is now when it undoes", async () => {
      const shape = elementOf("shape", { x: 100 });
      const { user } = await open(scene(shape));
      await user.click(row(/^Rectangle/));
      canvas().focus();
      await user.keyboard("{ArrowRight}");
      await waitFor(() => expect(savedElement()).toMatchObject({ x: 101 }));
      await studio(lastSave()!);

      // Not a step
      await user.click(
        layers().getByRole("button", { name: "Elements in this group" }),
      );
      await waitFor(() => expect(savedGroup(0)?.folded).toBe(true));
      await studio(lastSave()!);

      await user.click(undo());
      await waitFor(() => expect(savedElement()).toMatchObject({ x: 100 }));
      expect(savedGroup(0)?.folded).toBe(true);
      expect(undo()).toBeDisabled();
    });

    it("doesn't bring back a file deleted from the library", async () => {
      const media = elementOf("media", {
        file: "party.png",
        name: "Party",
        x: 100,
      });
      const { user } = await open(holding(media));
      await user.click(row(/^Party/));
      canvas().focus();
      await user.keyboard("{ArrowRight}");
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ x: 101 }),
      );
      await studio(lastSave()!);
      await send(APP_EVENTS_RESPONSE.ALERT_FILE_REMOVED, {
        field: "media",
        file: "party.png",
      });
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ file: "" }),
      );
      await studio(lastSave()!);

      await user.click(undo());
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({
          x: 100,
          file: "",
          name: "",
        }),
      );
    });

    it("deletes the selection with Delete or Backspace, on the canvas and in the list", async () => {
      const inside = elementOf("shape", { label: "Inside" });
      const g = group("Group 1", [inside]);
      const a = elementOf("shape");
      const b = text({ text: "Bee" });
      const locked = elementOf("emote", { locked: true });
      const { user } = await open(holding(g, a, b, locked));

      await user.click(row(/^Rectangle/));
      canvas().focus();
      await user.keyboard("{Delete}");
      await waitFor(() =>
        expect(savedIds()).toEqual([[g.id, inside.id], b.id, locked.id]),
      );

      // A number field keeps its keys
      await user.click(row(/^Bee/));
      const x = field("X").getByRole("spinbutton");
      expect(fireEvent.keyDown(x, { key: "Delete" })).toBe(true);
      canvas().focus();
      await user.keyboard("{Backspace}");
      await waitFor(() =>
        expect(savedIds()).toEqual([[g.id, inside.id], locked.id]),
      );

      // Locked, it stays on the canvas, and goes from the list
      await user.click(row(/^Emote/));
      canvas().focus();
      await user.keyboard("{Delete}");
      expect(row(/^Emote/)).toBeVisible();
      await user.click(row(/^Emote/));
      await user.keyboard("{Delete}");
      await waitFor(() => expect(savedIds()).toEqual([[g.id, inside.id]]));
      // The next row's name takes the focus
      expect(row(/^Group 1/)).toHaveFocus();

      await user.click(row(/^Group 1/));
      await user.keyboard("{Delete}");
      await waitFor(() => expect(lastSave()?.items).toEqual([]));

      await studio(lastSave()!);
      await user.click(undo());
      await waitFor(() => expect(savedIds()).toEqual([[g.id, inside.id]]));
    });
  });

  describe("zoom", () => {
    it("zooms with its buttons, its level under the canvas", async () => {
      const { user } = await open(studioOverlay("Main", { id: ID }));
      sized();
      const button = (name: string) => page().getByRole("button", { name });

      await user.click(button("Zoom in (Ctrl++)"));
      expect(zoomLevel()).toHaveTextContent("75%");
      expect(area().style.width).toBe("810px");
      expect(area().style.height).toBe("1440px");
      await user.click(button("Zoom out (Ctrl+-)"));
      expect(zoomLevel()).toHaveTextContent("50%");

      // Fitted again, at the stage's size
      await user.click(button("Zoom to fit (Ctrl+0)"));
      expect(zoomLevel()).toHaveTextContent("50%");
      expect(area().style.width).toBe("");
      await user.click(button("Zoom out (Ctrl+-)"));
      expect(zoomLevel()).toHaveTextContent("25%");
    });

    it("zooms with Ctrl and the wheel or its keys, in place of the window's zoom", async () => {
      await open(studioOverlay("Main", { id: ID }));
      sized();

      // The wheel alone scrolls
      expect(fireEvent.wheel(canvas(), { deltaY: -100 })).toBe(true);
      expect(fireEvent.wheel(canvas(), { deltaY: -100, ctrlKey: true })).toBe(
        false,
      );
      expect(zoomLevel()).toHaveTextContent("60%");

      expect(
        fireEvent.keyDown(document.body, { key: "=", ctrlKey: true }),
      ).toBe(false);
      expect(zoomLevel()).toHaveTextContent("75%");
      expect(
        fireEvent.keyDown(document.body, { key: "-", metaKey: true }),
      ).toBe(false);
      expect(zoomLevel()).toHaveTextContent("50%");
      fireEvent.keyDown(document.body, { key: "+", ctrlKey: true });
      expect(zoomLevel()).toHaveTextContent("75%");
      expect(
        fireEvent.keyDown(document.body, { key: "0", ctrlKey: true }),
      ).toBe(false);
      expect(area().style.width).toBe("");
    });

    it("leaves its keys and Undo's to a dialog", async () => {
      const media = elementOf("media");
      const { user } = await open(holding(media));
      sized();
      await user.click(row(/^Image or video/));
      await user.click(page().getByRole("button", { name: "Pick a file" }));
      const dialog = screen.getByRole("dialog");

      expect(fireEvent.keyDown(dialog, { key: "=", ctrlKey: true })).toBe(true);
      expect(fireEvent.keyDown(dialog, { key: "z", ctrlKey: true })).toBe(true);
      expect(area().style.width).toBe("");
    });

    it("pans with Space and a drag, and selects nothing", async () => {
      const shape = elementOf("shape", {
        x: 0,
        y: 0,
        width: 1080,
        height: 1920,
      });
      const { user } = await open(holding(shape));
      sized();
      const left = vi.spyOn(scroller(), "scrollLeft", "set");
      const top = vi.spyOn(scroller(), "scrollTop", "set");

      canvas().focus();
      expect(fireEvent.keyDown(canvas(), { key: " " })).toBe(false);
      expect(canvas().style.cursor).toBe("grab");
      // Over the shape, which a press would pick without Space
      press(200, 200);
      expect(canvas().style.cursor).toBe("grabbing");
      fireEvent.pointerMove(canvas(), { clientX: 70, clientY: 80 });
      expect(left).toHaveBeenLastCalledWith(30);
      expect(top).toHaveBeenLastCalledWith(20);
      fireEvent.pointerUp(canvas());
      fireEvent.keyUp(canvas(), { key: " " });
      expect(canvas().style.cursor).toBe("");
      expect(row(/^Rectangle/)).toHaveAttribute("aria-pressed", "false");
      expect(lastSave()).toBeUndefined();

      // A field keeps its Space
      await user.click(row(/^Rectangle/));
      const name = field("Name").getByRole("textbox");
      expect(fireEvent.keyDown(name, { key: " " })).toBe(true);
      expect(canvas().style.cursor).not.toBe("grab");
    });

    it("keeps the selection on a press on its scrollbars", async () => {
      const { user } = await open(holding(elementOf("shape")));
      sized();
      await user.click(row(/^Rectangle/));

      fireEvent.pointerDown(scroller(), { button: 0, clientX: 5, clientY: 5 });
      expect(row(/^Rectangle/)).toHaveAttribute("aria-pressed", "true");
    });

    it("shows the rulers only while they're on", async () => {
      const { user } = await open(studioOverlay("Main", { id: ID }));
      sized();
      vi.spyOn(scroller(), "clientWidth", "get").mockReturnValue(540);
      vi.spyOn(scroller(), "clientHeight", "get").mockReturnValue(960);
      const rulers = page().getByRole("button", {
        name: "Rulers and guides (Ctrl+R)",
      });
      const drawnRulers = () => document.querySelectorAll("[data-ruler]");
      expect(rulers).toHaveAttribute("aria-pressed", "false");
      expect(drawnRulers()).toHaveLength(0);

      await user.click(rulers);
      expect(rulers).toHaveAttribute("aria-pressed", "true");
      expect(drawnRulers()).toHaveLength(2);
      // At half size, a number every 200 px of the canvas
      await user.click(
        page().getByRole("button", { name: "Zoom in (Ctrl++)" }),
      );
      await user.click(
        page().getByRole("button", { name: "Zoom out (Ctrl+-)" }),
      );
      const top = within(
        document.querySelector<HTMLElement>("[data-ruler=top]")!,
      );
      expect(top.getByText("200")).toBeInTheDocument();
      expect(top.getByText("1000")).toBeInTheDocument();

      await user.click(rulers);
      expect(drawnRulers()).toHaveLength(0);
    });
  });
  describe("copy and paste", () => {
    const key = (key: string, target: Element = document.body) =>
      fireEvent.keyDown(target, { key, ctrlKey: true });

    it("pastes a copy of an element a step further each time, in its group", async () => {
      const shape = elementOf("shape", { x: 100, y: 100, label: "Badge" });
      const { user } = await open(scene(shape));
      await user.click(row(/^Badge/));

      expect(key("c")).toBe(false);
      key("v");
      await waitFor(() => expect(savedGroup(0)?.elements).toHaveLength(2));
      const first = savedGroup(0)!.elements[1];
      expect(first).toEqual({ ...shape, id: first.id, x: 120, y: 120 });
      expect(first.id).not.toBe(shape.id);
      // The copy is the selection, so the next one goes in its group too
      expect(
        document.querySelector(`[data-select="${first.id}"]`),
      ).toHaveAttribute("aria-pressed", "true");

      fireEvent.keyDown(document.body, { key: "v", metaKey: true });
      await waitFor(() => expect(savedGroup(0)?.elements).toHaveLength(3));
      expect(savedGroup(0)!.elements[2]).toMatchObject({ x: 140, y: 140 });
    });

    it("pastes a copied group as a new one, its elements with new ids", async () => {
      const a = elementOf("shape", { x: 10, y: 10 });
      const frame = group("Frame", [a]);
      const { user } = await open(holding(frame));
      await user.click(row(/^Frame/));

      key("c");
      key("v");
      await waitFor(() => expect(lastSave()?.items).toHaveLength(2));
      const copy = groupIn(lastSave(), 1)!;
      expect(copy).toMatchObject({ name: "Frame" });
      expect(copy.id).not.toBe(frame.id);
      expect(copy.elements).toEqual([
        { ...a, id: copy.elements[0].id, x: 30, y: 30 },
      ]);
      expect(copy.elements[0].id).not.toBe(a.id);
    });

    it("cuts the selection, and pastes it back where it was", async () => {
      const shape = elementOf("shape", { x: 100, y: 100 });
      const { user } = await open(holding(shape));
      await user.click(row(/^Rectangle/));

      expect(key("x")).toBe(false);
      await waitFor(() => expect(lastSave()?.items).toEqual([]));
      await studio(lastSave()!);
      key("v");
      await waitFor(() => expect(lastSave()?.items).toHaveLength(1));
      expect(lastSave()!.items[0]).toMatchObject({ x: 100, y: 100 });
      expect(lastSave()!.items[0].id).not.toBe(shape.id);

      // Each its own step
      await studio(lastSave()!);
      await user.click(undo());
      await waitFor(() => expect(lastSave()?.items).toEqual([]));
    });

    it("pastes into another overlay", async () => {
      const shape = elementOf("shape", { x: 100, y: 100 });
      const main = holding(shape);
      const other = studioOverlay("Other");
      const { user, router } = await open(main);
      await user.click(row(/^Rectangle/));
      key("c");

      await studio(main, other);
      await act(() =>
        router.navigate({
          to: "/tools/studio/$id",
          params: { id: other.id },
        }),
      );
      expect(
        await page().findByRole("heading", { name: "Other" }),
      ).toBeVisible();
      key("v");
      await waitFor(() => expect(lastSave()?.id).toBe(other.id));
      expect(lastSave()!.items).toMatchObject([{ x: 120, y: 120 }]);
    });

    describe("a deleted file", () => {
      const removed = () =>
        send(APP_EVENTS_RESPONSE.ALERT_FILE_REMOVED, {
          field: "media",
          file: "party.png",
        });
      const pastedFile = () => {
        const items = lastSave()?.items ?? [];
        return items.at(-1)?.kind === "media" ? items.at(-1) : undefined;
      };

      it("leaves the clipboard while the editor is open", async () => {
        const media = elementOf("media", { file: "party.png", name: "Party" });
        const { user } = await open(holding(media));
        await user.click(row(/^Party/));
        key("c");

        await removed();
        await studio(await saved());
        key("v");

        await waitFor(() => expect(lastSave()?.items).toHaveLength(2));
        expect(pastedFile()).toMatchObject({ file: "", name: "" });
      });

      it("leaves the clipboard with the editor closed", async () => {
        const media = elementOf("media", { file: "party.png", name: "Party" });
        const main = holding(media);
        const other = studioOverlay("Other");
        const { user, router } = await open(main);
        await user.click(row(/^Party/));
        key("c");

        await act(() => router.navigate({ to: "/tools/studio" }));
        await removed();
        await act(() =>
          router.navigate({
            to: "/tools/studio/$id",
            params: { id: other.id },
          }),
        );
        await studio(main, other);
        expect(
          await page().findByRole("heading", { name: "Other" }),
        ).toBeVisible();
        key("v");

        await waitFor(() => expect(lastSave()?.id).toBe(other.id));
        expect(pastedFile()).toMatchObject({ file: "", name: "" });
      });
    });

    it("leaves copy, cut and paste to a field", async () => {
      const { user } = await open(holding(elementOf("shape")));
      await user.click(row(/^Rectangle/));

      const x = field("X").getByRole("spinbutton");
      expect(key("c", x)).toBe(true);
      expect(key("v", x)).toBe(true);
      expect(key("x", field("Name").getByRole("textbox"))).toBe(true);
      expect(lastSave()).toBeUndefined();
    });
  });

  describe("guides and sticking", () => {
    const toggle = () =>
      page().getByRole("button", { name: "Rulers and guides (Ctrl+R)" });
    const ruler = (side: "top" | "left") =>
      document.querySelector<HTMLElement>(`[data-ruler=${side}]`)!;
    const guideLines = (axis: "x" | "y") =>
      canvas().querySelectorAll<HTMLElement>(`[data-guide=${axis}]`);
    const roseLines = () => canvas().querySelectorAll("[data-met]");
    // The dragged guide's place on its ruler
    const mark = (side: "top" | "left") =>
      ruler(side).querySelector("[data-mark]")?.getAttribute("data-mark");
    const guidesList = () =>
      within(page().getByRole("group", { name: "Guides" }));
    // The overlay with its rulers on, these guides and items
    const ruled = (
      guides: Partial<StudioOverlay["guides"]>,
      ...items: StudioItem[]
    ) =>
      studioOverlay("Main", {
        id: ID,
        rulers: true,
        guides: { x: [], y: [], locked: false, ...guides },
        items,
      });
    // The canvas at half size, its view as big
    function viewSized() {
      sized();
      vi.spyOn(scroller(), "clientWidth", "get").mockReturnValue(540);
      vi.spyOn(scroller(), "clientHeight", "get").mockReturnValue(960);
    }
    // A drag on the canvas from one point of it to another, in its px
    const drag = (
      from: [number, number],
      to: [number, number],
      keys: { altKey?: boolean; ctrlKey?: boolean } = {},
    ) => {
      fireEvent.pointerDown(canvas(), {
        button: 0,
        clientX: from[0] / 2,
        clientY: from[1] / 2,
        ...keys,
      });
      fireEvent.pointerMove(canvas(), {
        clientX: to[0] / 2,
        clientY: to[1] / 2,
        ...keys,
      });
      fireEvent.pointerUp(canvas());
    };

    it("shows and hides the rulers with Ctrl+R, saved with the overlay and left by Undo", async () => {
      const { user } = await open(holding(elementOf("shape")));
      expect(toggle()).toHaveAttribute("aria-pressed", "false");

      await user.type(field("Name").getByRole("textbox"), "x");
      expect(
        fireEvent.keyDown(document.body, { key: "r", ctrlKey: true }),
      ).toBe(false);
      expect(toggle()).toHaveAttribute("aria-pressed", "true");
      expect(document.querySelectorAll("[data-ruler]")).toHaveLength(2);
      await waitFor(() =>
        expect(lastSave()).toMatchObject({ name: "Mainx", rulers: true }),
      );
      // With Shift it's the window's reload still
      expect(
        fireEvent.keyDown(document.body, {
          key: "R",
          ctrlKey: true,
          shiftKey: true,
        }),
      ).toBe(true);

      await user.click(undo());
      await waitFor(() =>
        expect(lastSave()).toMatchObject({ name: "Main", rulers: true }),
      );
      expect(toggle()).toHaveAttribute("aria-pressed", "true");
    });

    it("opens an overlay saved with its rulers on with them on", async () => {
      await open(ruled({ x: [200] }));

      expect(toggle()).toHaveAttribute("aria-pressed", "true");
      expect(document.querySelectorAll("[data-ruler]")).toHaveLength(2);
      expect(guideLines("x")).toHaveLength(1);
    });

    it("adds a guide with Ctrl and a drag from a ruler, where it's let go", async () => {
      await open(ruled({}));
      viewSized();
      const fromTop = (to: number, keys = { ctrlKey: true }) => {
        fireEvent.pointerDown(ruler("top"), {
          button: 0,
          clientX: 100,
          clientY: -10,
          ...keys,
        });
        fireEvent.pointerMove(canvas(), { clientX: 100, clientY: to, ...keys });
      };

      // A plain press is the ruler's
      fromTop(150, { ctrlKey: false });
      fireEvent.pointerUp(canvas());
      expect(guideLines("y")).toHaveLength(0);

      // Drawn while it's dragged, then back on the ruler: none
      fromTop(150.3);
      expect(guideLines("y")).toHaveLength(1);
      expect(mark("left")).toBe("301");
      fireEvent.pointerMove(canvas(), { clientX: 100, clientY: -5 });
      expect(guideLines("y")).toHaveLength(0);
      fireEvent.pointerUp(canvas());
      expect(lastSave()).toBeUndefined();

      fromTop(150.3);
      fireEvent.pointerUp(canvas());
      await waitFor(() =>
        expect(lastSave()?.guides).toEqual({ x: [], y: [301], locked: false }),
      );
      expect(guideLines("y")[0].style.top).toBe("151px");
      expect(mark("left")).toBeUndefined();
    });

    it("moves a guide with Ctrl and a drag, takes it away off the view, and Undo brings it back", async () => {
      const { user } = await open(ruled({ x: [200] }));
      viewSized();

      // With Ctrl over it, the cursor to move it
      fireEvent.pointerMove(canvas(), { clientX: 101, clientY: 300 });
      expect(canvas().style.cursor).toBe("");
      fireEvent.pointerMove(canvas(), {
        clientX: 101,
        clientY: 300,
        ctrlKey: true,
      });
      expect(canvas().style.cursor).toBe("col-resize");

      // A plain press there is the canvas's
      drag([202, 600], [320, 600]);
      expect(lastSave()).toBeUndefined();

      drag([202, 600], [320, 600], { ctrlKey: true });
      await waitFor(() => expect(lastSave()?.guides.x).toEqual([320]));
      expect(guideLines("x")[0].style.left).toBe("160px");
      drag([320, 600], [-20, 600], { ctrlKey: true });
      await waitFor(() => expect(lastSave()?.guides.x).toEqual([]));

      await user.click(undo());
      await waitFor(() => expect(lastSave()?.guides.x).toEqual([320]));
    });

    it("sticks a dragged guide to the canvas's middle and an element's edge, but not with Alt", async () => {
      const shape = elementOf("shape", { x: 100, y: 400, width: 200 });
      await open(ruled({}, shape));
      viewSized();
      const fromLeft = (to: number, keys = {}) => {
        fireEvent.pointerDown(ruler("left"), {
          button: 0,
          clientX: -10,
          clientY: 300,
          ctrlKey: true,
        });
        fireEvent.pointerMove(canvas(), {
          clientX: to / 2,
          clientY: 300,
          ctrlKey: true,
          ...keys,
        });
      };

      // 534, 6 from the middle
      fromLeft(534);
      expect(mark("top")).toBe("540");
      fireEvent.pointerUp(canvas());
      await waitFor(() => expect(lastSave()?.guides.x).toEqual([540]));
      // 294, 6 from the shape's right edge
      fromLeft(294);
      fireEvent.pointerUp(canvas());
      await waitFor(() => expect(lastSave()?.guides.x).toEqual([540, 300]));
      fromLeft(294, { altKey: true });
      fireEvent.pointerUp(canvas());
      await waitFor(() =>
        expect(lastSave()?.guides.x).toEqual([540, 300, 294]),
      );
    });

    it("adds and moves no guide on the canvas while they're locked", async () => {
      await open(ruled({ x: [200], locked: true }));
      viewSized();

      fireEvent.pointerDown(ruler("top"), {
        button: 0,
        clientX: 100,
        clientY: -10,
        ctrlKey: true,
      });
      fireEvent.pointerMove(canvas(), {
        clientX: 100,
        clientY: 150,
        ctrlKey: true,
      });
      fireEvent.pointerUp(canvas());
      drag([200, 600], [320, 600], { ctrlKey: true });

      expect(lastSave()).toBeUndefined();
      expect(guideLines("x")).toHaveLength(1);
      expect(guideLines("y")).toHaveLength(0);
    });

    it("lists the guides in the overlay's settings while the rulers show", async () => {
      const { user } = await open(
        studioOverlay("Main", {
          id: ID,
          guides: { x: [200], y: [400], locked: false },
        }),
      );
      expect(
        page().queryByRole("group", { name: "Guides" }),
      ).not.toBeInTheDocument();
      await user.click(toggle());

      const vertical = guidesList().getByRole("spinbutton", {
        name: "Vertical guide 1",
      });
      expect(vertical).toHaveValue(200);
      expect(
        guidesList().getByRole("spinbutton", { name: "Horizontal guide 1" }),
      ).toHaveValue(400);
      await user.clear(vertical);
      await user.type(vertical, "250");
      await waitFor(() => expect(lastSave()?.guides.x).toEqual([250]));

      // At the canvas's middle
      await user.click(
        guidesList().getByRole("button", { name: "Add horizontal" }),
      );
      await waitFor(() => expect(lastSave()?.guides.y).toEqual([400, 960]));
      await user.click(
        guidesList().getByRole("button", { name: "Remove vertical guide 1" }),
      );
      await waitFor(() => expect(lastSave()?.guides.x).toEqual([]));

      const lock = guidesList().getByRole("button", { name: "Lock guides" });
      await user.click(lock);
      expect(lock).toHaveAttribute("aria-pressed", "true");
      await waitFor(() => expect(lastSave()?.guides.locked).toBe(true));

      await user.click(
        guidesList().getByRole("button", { name: "Remove all guides" }),
      );
      await waitFor(() =>
        expect(lastSave()?.guides).toEqual({ x: [], y: [], locked: true }),
      );
      expect(guidesList().getByText(/^No guides yet/)).toBeVisible();
      expect(
        guidesList().getByRole("button", { name: "Remove all guides" }),
      ).toBeDisabled();
    });

    it("adds no guide past 50 on an axis", async () => {
      const fifty = Array.from({ length: 50 }, (_, i) => i * 10);
      await open(ruled({ x: fifty }));
      viewSized();

      expect(
        guidesList().getByRole("button", { name: "Add vertical" }),
      ).toBeDisabled();
      expect(
        guidesList().getByRole("button", { name: "Add horizontal" }),
      ).toBeEnabled();
      fireEvent.pointerDown(ruler("left"), {
        button: 0,
        clientX: -10,
        clientY: 300,
        ctrlKey: true,
      });
      fireEvent.pointerMove(canvas(), {
        clientX: 300,
        clientY: 300,
        ctrlKey: true,
      });
      fireEvent.pointerUp(canvas());
      expect(lastSave()).toBeUndefined();
    });

    it("sticks a dragged element to the canvas's edges and middle, within 6 screen px", async () => {
      const shape = elementOf("shape", {
        x: 100,
        y: 200,
        width: 200,
        height: 100,
      });
      await open(holding(shape));
      viewSized();

      // Its left edge 4 from the canvas's: there, with a rose line until
      // it's let go
      fireEvent.pointerDown(canvas(), { button: 0, clientX: 75, clientY: 125 });
      fireEvent.pointerMove(canvas(), { clientX: 27, clientY: 125 });
      expect(roseLines().length).toBeGreaterThan(0);
      fireEvent.pointerUp(canvas());
      expect(roseLines()).toHaveLength(0);
      await waitFor(() => expect(lastSave()?.items[0]).toMatchObject({ x: 0 }));

      // 14 away, past 6 screen px: where it's let go
      drag([50, 250], [64, 250]);
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ x: 14, y: 200 }),
      );
      // Its middle 5 from the canvas's
      drag([64, 250], [485, 250]);
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ x: 440, y: 200 }),
      );
      // With Alt, nothing sticks and no rose line shows
      fireEvent.pointerDown(canvas(), {
        button: 0,
        clientX: 245,
        clientY: 125,
      });
      fireEvent.pointerMove(canvas(), {
        clientX: 242,
        clientY: 125,
        altKey: true,
      });
      expect(roseLines()).toHaveLength(0);
      fireEvent.pointerUp(canvas());
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ x: 434 }),
      );
    });

    it("sticks a dragged element to other elements, and to guides while they show", async () => {
      const shape = elementOf("shape", {
        x: 100,
        y: 200,
        width: 200,
        height: 100,
      });
      const other = elementOf("shape", {
        x: 600,
        y: 1000,
        width: 100,
        height: 100,
      });
      const { user } = await open(ruled({ y: [700] }, shape, other));
      viewSized();

      // Its left edge 4 from the other's, its top 5 from the other's
      drag([150, 250], [646, 1045]);
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ x: 600, y: 1000 }),
      );
      // Its top 5 from the guide, pressed where the other isn't in front
      drag([750, 1050], [750, 745]);
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ x: 600, y: 700 }),
      );
      // The rulers off, the guide isn't there to stick to
      await user.click(toggle());
      drag([750, 750], [750, 740]);
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ x: 600, y: 690 }),
      );
    });

    it("sticks a dragged group to other elements, never its own", async () => {
      const left = elementOf("shape", {
        x: 100,
        y: 100,
        width: 100,
        height: 100,
      });
      const right = elementOf("shape", {
        x: 300,
        y: 100,
        width: 100,
        height: 100,
      });
      const apart = elementOf("shape", {
        x: 500,
        y: 600,
        width: 100,
        height: 100,
      });
      const { user } = await open(holding(group("Pair", [left, right]), apart));
      await user.click(row(/^Pair/));
      viewSized();

      // 10 from its own elements' lines, which it never sticks to
      drag([250, 150], [260, 150]);
      await waitFor(() =>
        expect(groupIn(lastSave(), 0)?.elements[0]).toMatchObject({ x: 110 }),
      );
      // Its right edge 4 from the other element's left
      drag([260, 150], [346, 150]);
      await waitFor(() =>
        expect(groupIn(lastSave(), 0)?.elements).toMatchObject([
          { x: 200 },
          { x: 400 },
        ]),
      );
    });

    it("sticks a dragged corner, on the diagonal with Link on", async () => {
      const shape = elementOf("shape", {
        label: "Box",
        x: 100,
        y: 100,
        width: 100,
        height: 100,
      });
      const other = elementOf("shape", {
        label: "Other",
        x: 400,
        y: 600,
        width: 100,
        height: 100,
      });
      const { user } = await open(holding(shape, other));
      await user.click(row(/^Box/));
      viewSized();

      // The corner at 394 across, 6 from the other's left edge
      fireEvent.pointerDown(handle("se"), {
        button: 0,
        clientX: 0,
        clientY: 0,
      });
      fireEvent.pointerMove(canvas(), { clientX: 97, clientY: 50 });
      fireEvent.pointerUp(canvas());
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ width: 300, height: 200 }),
      );

      await user.click(
        page().getByRole("button", { name: "Link width and height" }),
      );
      // Linked, 4 short of the other's right edge across: along the
      // diagonal to it
      fireEvent.pointerDown(handle("se"), {
        button: 0,
        clientX: 0,
        clientY: 0,
      });
      fireEvent.pointerMove(canvas(), { clientX: 48, clientY: 32 });
      fireEvent.pointerUp(canvas());
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ width: 400, height: 267 }),
      );
    });
  });

  describe("cropping", () => {
    const WHOLE = { left: 0, top: 0, right: 0, bottom: 0 };
    // A 400 × 200 picture element at 100, 100
    const pic = (patch: Partial<StudioElementOf<"media">> = {}) =>
      elementOf("media", {
        label: "Pic",
        file: "pic.png",
        name: "pic.png",
        x: 100,
        y: 100,
        width: 400,
        height: 200,
        ...patch,
      });
    // The canvas, named for cropping while it crops
    const stage = canvas;
    // The stage read the picture's own size
    const loaded = (id: string, width: number, height: number) => {
      const img = drawn(id).querySelector("img")!;
      Object.defineProperty(img, "naturalWidth", { value: width });
      Object.defineProperty(img, "naturalHeight", { value: height });
      act(() => {
        img.dispatchEvent(new Event("load"));
      });
    };
    const side = (name: string) => field(name).getByRole("spinbutton");
    const cropHandle = (at: string) =>
      document.querySelector<HTMLElement>(`[data-crop="${at}"]`)!;

    it("crops a picture from its fields, its box trimmed so it stays put", async () => {
      const shown = pic();
      const { user } = await open(holding(shown));
      await user.click(row(/^Pic/));
      // Twice the box's size, so at half size and no empty bands
      loaded(shown.id, 800, 400);

      await user.clear(side("Left"));
      await user.type(side("Left"), "25");
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({
          crop: { ...WHOLE, left: 0.25 },
          x: 200,
          y: 100,
          width: 300,
          height: 200,
        }),
      );

      // All of it back, where it was: main holds the crop first, or the
      // autosave would see nothing new to send
      await studio(lastSave()!);
      await user.click(page().getByRole("button", { name: "Reset the crop" }));
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({
          crop: WHOLE,
          x: 100,
          width: 400,
        }),
      );
      expect(
        page().getByRole("button", { name: "Reset the crop" }),
      ).toBeDisabled();

      fireEvent.change(
        page().getByRole("slider", { name: "Round corners (0%)" }),
        { target: { value: "50" } },
      );
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ rounding: 50 }),
      );
    });

    it("crops a viewer's picture from its fields only, its box kept", async () => {
      const viewer = elementOf("viewer", { label: "Fan", x: 100, y: 100 });
      const { user } = await open(holding(viewer));
      await user.click(row(/^Fan/));

      expect(
        page().queryByRole("button", {
          name: "Crop on the canvas (double-click)",
        }),
      ).not.toBeInTheDocument();
      expect(
        page().getByRole("slider", { name: "Round corners (50%)" }),
      ).toBeVisible();
      await user.clear(side("Top"));
      await user.type(side("Top"), "20");
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({
          crop: { ...WHOLE, top: 0.2 },
          x: 100,
          y: 100,
          width: viewer.width,
          height: viewer.height,
        }),
      );
    });

    it("crops on the canvas from a double-click, kept with Enter as one step", async () => {
      const shown = pic();
      const { user } = await open(holding(shown));
      sized();
      loaded(shown.id, 800, 400);

      // Its middle, (300, 200) on the canvas
      fireEvent.doubleClick(stage(), { clientX: 150, clientY: 100 });
      expect(stage()).toHaveAccessibleDescription(/^Cropping\./);
      expect(document.querySelectorAll("[data-crop]")).toHaveLength(8);
      expect(undo()).toBeDisabled();

      // Its right side 100 in
      fireEvent.pointerDown(cropHandle("e"), {
        button: 0,
        clientX: 250,
        clientY: 100,
      });
      fireEvent.pointerMove(stage(), { clientX: 200, clientY: 100 });
      fireEvent.pointerUp(stage());
      fireEvent.keyDown(stage(), { key: "Enter" });

      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({
          crop: { ...WHOLE, right: 0.25 },
          x: 100,
          y: 100,
          width: 300,
          height: 200,
        }),
      );
      expect(stage()).toHaveAccessibleDescription(/^Move the selection/);
      expect(document.querySelector("[data-crop]")).toBeNull();

      await studio(lastSave()!);
      await user.click(undo());
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ crop: WHOLE, width: 400 }),
      );
    });

    it("crops a camera on the canvas too", async () => {
      const camera = elementOf("camera", {
        label: "Cam",
        x: 100,
        y: 100,
        width: 400,
        height: 200,
      });
      const { user } = await open(holding(camera));
      await user.click(row(/^Cam/));
      sized();
      // Its stream's first frame
      const video = drawn(camera.id).querySelector("video")!;
      Object.defineProperty(video, "videoWidth", { value: 1280 });
      Object.defineProperty(video, "videoHeight", { value: 640 });
      act(() => {
        video.dispatchEvent(new Event("loadedmetadata"));
      });

      await user.click(
        page().getByRole("button", {
          name: "Crop on the canvas (double-click)",
        }),
      );
      expect(stage()).toHaveAccessibleDescription(/^Cropping\./);
      fireEvent.pointerDown(cropHandle("e"), {
        button: 0,
        clientX: 250,
        clientY: 100,
      });
      fireEvent.pointerMove(stage(), { clientX: 200, clientY: 100 });
      fireEvent.pointerUp(stage());
      fireEvent.keyDown(stage(), { key: "Enter" });

      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({
          crop: { ...WHOLE, right: 0.25 },
          width: 300,
          height: 200,
        }),
      );
    });

    it("cancels a canvas crop with Escape, and keeps one with a click past it", async () => {
      const shown = pic();
      const { user } = await open(holding(shown));
      await user.click(row(/^Pic/));
      sized();
      loaded(shown.id, 800, 400);
      const drag = () => {
        fireEvent.pointerDown(cropHandle("w"), {
          button: 0,
          clientX: 50,
          clientY: 100,
        });
        fireEvent.pointerMove(stage(), { clientX: 100, clientY: 100 });
        fireEvent.pointerUp(stage());
      };

      await user.click(
        page().getByRole("button", {
          name: "Crop on the canvas (double-click)",
        }),
      );
      drag();
      fireEvent.keyDown(stage(), { key: "Escape" });
      expect(document.querySelector("[data-crop]")).toBeNull();
      expect(lastSave()).toBeUndefined();

      fireEvent.doubleClick(stage(), { clientX: 150, clientY: 100 });
      drag();
      // Far past the frame, on the empty canvas
      fireEvent.pointerDown(stage(), { button: 0, clientX: 20, clientY: 400 });
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({
          crop: { ...WHOLE, left: 0.25 },
          x: 200,
          width: 300,
        }),
      );
      // Still selected, and nothing else picked
      expect(row(/^Pic/)).toHaveAttribute("aria-pressed", "true");
    });

    it("holds the picture and its group still while it crops", async () => {
      const shown = pic({ when: "loop", idle: "spin" });
      const { user } = await open(
        holding(group("Group 1", [shown], { when: "loop", idle: "drift" })),
      );
      await user.click(row(/^Pic/));
      sized();
      loaded(shown.id, 800, 400);
      // By its id: the canvas has another name while it crops
      const node = () =>
        document.querySelector<HTMLElement>(`[data-element="${shown.id}"]`)!;
      const body = () => node().querySelector(".studio-body")!;
      const mover = () => node().closest(".studio-group")!;
      expect(body().className).toMatch(/studio-loop-spin/);
      expect(mover().className).toMatch(/studio-loop-drift/);

      await user.click(
        page().getByRole("button", {
          name: "Crop on the canvas (double-click)",
        }),
      );
      expect(body().className).not.toMatch(/studio-loop-/);
      expect(mover().className).not.toMatch(/studio-loop-/);

      fireEvent.keyDown(stage(), { key: "Escape" });
      expect(body().className).toMatch(/studio-loop-spin/);
      expect(mover().className).toMatch(/studio-loop-drift/);
    });

    it("crops no locked picture on the canvas", async () => {
      const shown = pic({ locked: true });
      await open(holding(shown));
      sized();
      loaded(shown.id, 800, 400);

      fireEvent.doubleClick(stage(), { clientX: 150, clientY: 100 });
      expect(document.querySelector("[data-crop]")).toBeNull();
    });

    it("starts another emote uncropped", async () => {
      const emote = elementOf("emote", {
        label: "Wave",
        emote: { id: "e1", image: "https://x/e1.png" },
        crop: { ...WHOLE, left: 0.25 },
      });
      const { user } = await open(holding(emote));
      await user.click(row(/^Wave/));

      await user.click(
        page().getByRole("radio", { name: "The emote a viewer sends" }),
      );
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({
          emote: null,
          crop: WHOLE,
        }),
      );
    });
  });
});
