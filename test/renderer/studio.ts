// Overlay Studio's editor tests' helpers, shared by the editor's test files
import {
  StudioElement,
  StudioElementKind,
  StudioElementOf,
  StudioElementSchema,
  StudioGroup,
  StudioItem,
  StudioOverlay,
} from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { newStudioElement, newStudioGroup } from "@/common/util";
import { studioOverlay } from "@test/fixtures";
import { send, sent } from "@test/ipc";
import { renderApp } from "@test/render";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, vi } from "vitest";

export const ID = "1b4e28ba-2fa1-41d2-883f-0016d3cca427";

export const elementOf = <K extends StudioElementKind>(
  kind: K,
  patch: Partial<StudioElementOf<K>> = {},
) =>
  StudioElementSchema.parse({
    ...newStudioElement(kind, "portrait"),
    ...patch,
  });
export const text = (patch: Partial<StudioElementOf<"text">> = {}) =>
  elementOf("text", patch);
// A group holding the elements, back to front
export const group = (
  name: string,
  elements: StudioElement[] = [],
  patch: Partial<StudioGroup> = {},
): StudioGroup => ({ ...newStudioGroup(name), elements, ...patch });
// The overlay holding these items, back to front
export const holding = (...items: StudioItem[]) =>
  studioOverlay("Main", { id: ID, items });
// The overlay with one group holding the elements
export const scene = (...elements: StudioElement[]) =>
  studioOverlay("Main", { id: ID, items: [group("Group 1", elements)] });

export const studio = (...data: StudioOverlay[]) =>
  send(APP_EVENTS_RESPONSE.STUDIO, { success: true, data });

export async function open(
  overlay: StudioOverlay,
  options?: Parameters<typeof renderApp>[1],
) {
  const view = await renderApp(`/tools/studio/${overlay.id}`, options);
  await studio(overlay);
  return view;
}

// The newest overlay sent to be saved
export const lastSave = () =>
  sent(APP_EVENTS.SAVE_STUDIO_OVERLAY).at(-1)?.overlay;
export const saved = async () => {
  await waitFor(() => expect(lastSave()).toBeDefined());
  return lastSave()!;
};
// The overlay's item there, a group
export const groupIn = (overlay: StudioOverlay | undefined, at: number) => {
  const item = overlay?.items[at];
  return item?.kind === "group" ? item : undefined;
};
// The last saved item there, a group
export const savedGroup = (at: number) => groupIn(lastSave(), at);
// The first group's first element, as last saved
export const savedElement = () => savedGroup(0)?.elements[0];
// Each item's id, a group's with its elements', as last saved
export const savedIds = () =>
  lastSave()?.items.map((item) =>
    item.kind === "group"
      ? [item.id, ...item.elements.map((e) => e.id)]
      : item.id,
  );
// The last saved items' names, a group's or an element's label
export const savedNames = () =>
  lastSave()?.items.map((item) =>
    item.kind === "group" ? item.name : item.label,
  );

export const page = () => within(screen.getByRole("main"));
export const layers = () =>
  within(page().getByRole("list", { name: "Elements" }));
export const row = (name: RegExp) => layers().getByRole("button", { name });
// The row a group's or an element's select button is in
export const rowOf = (name: RegExp) =>
  within(row(name).closest<HTMLElement>("[data-row]")!);
export const grip = (id: string) =>
  document.querySelector<HTMLElement>(`[data-grip="${id}"]`)!;
export const canvas = () =>
  page().getByLabelText("Canvas", { selector: "[role=application]" });
export const drawn = (id: string) =>
  canvas().querySelector<HTMLElement>(`[data-element="${id}"]`)!;
export const field = (name: string) =>
  within(page().getByRole("group", { name }));
export const addMenu = () =>
  page().getByRole("button", { name: "Add a group or an element" });
// The + menu's buttons, while it's open
export const addItems = () =>
  within(addMenu().nextElementSibling as HTMLElement);
export const deleteButton = (name: string) =>
  page().getByRole("button", { name });
export const undo = () => page().getByRole("button", { name: "Undo (Ctrl+Z)" });
export const redo = () => page().getByRole("button", { name: "Redo (Ctrl+Y)" });
// The zoom's level under the canvas, its view, and the canvas's room in it
export const zoomLevel = () => page().getByRole("status", { name: "Zoom" });
export const scroller = () =>
  canvas().querySelector<HTMLElement>("[class*=stage_scroll]")!;
export const area = () =>
  canvas().querySelector<HTMLElement>("[class*=stage_area]")!;

// The canvas at half size on screen, 540 × 960 from the root's top left
// (jsdom's getBoundingClientRect is all zeros)
export function sized() {
  const root = canvas().querySelector<HTMLElement>(".studio-stage")!;
  vi.spyOn(root, "clientWidth", "get").mockReturnValue(540);
  vi.spyOn(root, "clientHeight", "get").mockReturnValue(960);
}
// A corner's resize handle on the canvas
export const handle = (corner: string) =>
  canvas().querySelector<HTMLElement>(`[data-handle="${corner}"]`)!;
// A press on the canvas at a point of it, in its px
export const press = (x: number, y: number) =>
  fireEvent.pointerDown(canvas(), {
    button: 0,
    clientX: x / 2,
    clientY: y / 2,
  });
