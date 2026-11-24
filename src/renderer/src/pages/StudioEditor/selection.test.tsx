// Overlay Studio's editor: several items selected at once
import { StudioElementOf } from "@/common/schemas";
import { fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  elementOf,
  group,
  holding,
  studio,
  open,
  lastSave,
  groupIn,
  savedGroup,
  savedIds,
  savedNames,
  page,
  row,
  rowOf,
  canvas,
  field,
  undo,
  sized,
  handle,
} from "@test/studio";

describe("selecting several on the canvas", () => {
  beforeEach(() => {
    Element.prototype.setPointerCapture = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // A named 100 × 100 shape at a point of the canvas
  const shape = (label: string, x: number, y: number) =>
    elementOf("shape", { label, x, y, width: 100, height: 100 });
  const ann = shape("Ann", 100, 100);
  const bob = shape("Bob", 400, 100);
  const cat = shape("Cat", 100, 600);
  type Keys = { shiftKey?: boolean; altKey?: boolean };
  // A press and a release at a point of the canvas, in its px
  const click = (x: number, y: number, keys: Keys = {}) => {
    fireEvent.pointerDown(canvas(), {
      button: 0,
      clientX: x / 2,
      clientY: y / 2,
      ...keys,
    });
    fireEvent.pointerUp(canvas());
  };
  // A drag from one point of the canvas to another, in its px
  const dragOn = (
    from: [number, number],
    to: [number, number],
    keys: Keys = {},
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
  const picked = () =>
    ["Ann", "Bob", "Cat"].filter(
      (name) =>
        row(new RegExp(`^${name}`)).getAttribute("aria-pressed") === "true",
    );
  const outlines = () => canvas().querySelectorAll("[data-selected]");
  const savedAt = (at: number) => lastSave()?.items[at];

  it("adds and takes out with Shift, each outlined with no handles", async () => {
    await open(holding(ann, bob, cat));
    sized();

    click(150, 150);
    click(450, 150, { shiftKey: true });
    expect(picked()).toEqual(["Ann", "Bob"]);
    expect(outlines()).toHaveLength(2);
    expect(canvas().querySelector("[data-selected-around]")).not.toBeNull();
    expect(canvas().querySelector("[data-handle]")).toBeNull();

    click(150, 150, { shiftKey: true });
    expect(picked()).toEqual(["Bob"]);
    // One again, with its handles
    expect(outlines()).toHaveLength(0);
    expect(handle("se")).not.toBeNull();

    // Shift on empty canvas keeps the selection, a click there clears it
    click(800, 1500, { shiftKey: true });
    expect(picked()).toEqual(["Bob"]);
    click(800, 1500);
    expect(picked()).toEqual([]);
  });

  it("box selects what a drag from empty canvas touches, Shift adding, never a locked one", async () => {
    const locked = { ...shape("Dot", 100, 350), locked: true };
    await open(holding(ann, bob, cat, locked));
    sized();

    // Over Bob's corner, from the empty canvas past it
    fireEvent.pointerDown(canvas(), { button: 0, clientX: 350, clientY: 25 });
    fireEvent.pointerMove(canvas(), { clientX: 240, clientY: 60 });
    expect(canvas().querySelector("[data-box-select]")).not.toBeNull();
    fireEvent.pointerUp(canvas());
    expect(canvas().querySelector("[data-box-select]")).toBeNull();
    expect(picked()).toEqual(["Bob"]);

    // Ann, the locked Dot between, and Cat, added
    dragOn([50, 50], [160, 700], { shiftKey: true });
    expect(picked()).toEqual(["Ann", "Bob", "Cat"]);
    expect(row(/^Dot/)).toHaveAttribute("aria-pressed", "false");

    // Without Shift it starts over
    dragOn([50, 550], [160, 700]);
    expect(picked()).toEqual(["Cat"]);
  });

  it("drags several in one step, a locked one staying, and a click picks one of them", async () => {
    const { user } = await open(holding(ann, bob, cat));
    sized();
    click(150, 150);
    click(450, 150, { shiftKey: true });
    click(150, 650, { shiftKey: true });
    await user.click(
      rowOf(/^Cat/).getByRole("button", { name: "Lock element" }),
    );
    await waitFor(() => expect(savedAt(2)).toMatchObject({ locked: true }));
    await studio(lastSave()!);
    expect(picked()).toEqual(["Ann", "Bob", "Cat"]);

    fireEvent.pointerDown(canvas(), { button: 0, clientX: 75, clientY: 75 });
    fireEvent.pointerMove(canvas(), { clientX: 100, clientY: 75 });
    fireEvent.pointerMove(canvas(), { clientX: 125, clientY: 90 });
    fireEvent.pointerUp(canvas());
    await waitFor(() => {
      expect(savedAt(0)).toMatchObject({ x: 200, y: 130 });
      expect(savedAt(1)).toMatchObject({ x: 500, y: 130 });
    });
    expect(savedAt(2)).toMatchObject({ x: 100, y: 600 });
    expect(picked()).toEqual(["Ann", "Bob", "Cat"]);
    await studio(lastSave()!);

    await user.click(undo());
    await waitFor(() => {
      expect(savedAt(0)).toMatchObject({ x: 100, y: 100 });
      expect(savedAt(1)).toMatchObject({ x: 400, y: 100 });
    });
    expect(savedAt(2)).toMatchObject({ locked: true });

    // A click on one of them, that doesn't move, picks it alone
    click(450, 150);
    expect(picked()).toEqual(["Bob"]);
  });

  it("sticks several by the box around them, unless Alt is down", async () => {
    await open(holding(ann, bob));
    sized();
    click(150, 150);
    click(450, 150, { shiftKey: true });

    // Their box's left edge 5 px from the canvas's
    dragOn([150, 150], [55, 150]);
    await waitFor(() => {
      expect(savedAt(0)).toMatchObject({ x: 0, y: 100 });
      expect(savedAt(1)).toMatchObject({ x: 300, y: 100 });
    });
    await studio(lastSave()!);

    dragOn([50, 150], [58, 150], { altKey: true });
    await waitFor(() => {
      expect(savedAt(0)).toMatchObject({ x: 8, y: 100 });
      expect(savedAt(1)).toMatchObject({ x: 308, y: 100 });
    });
  });

  it("nudges several with the arrows, a locked one staying, and deletes the ones not locked", async () => {
    const { user } = await open(holding(ann, bob, cat));
    sized();
    click(150, 150);
    click(450, 150, { shiftKey: true });
    click(150, 650, { shiftKey: true });
    await user.click(
      rowOf(/^Cat/).getByRole("button", { name: "Lock element" }),
    );
    await waitFor(() => expect(savedAt(2)).toMatchObject({ locked: true }));
    await studio(lastSave()!);

    canvas().focus();
    await user.keyboard("{ArrowRight}{Shift>}{ArrowDown}{/Shift}");
    await waitFor(() => {
      expect(savedAt(0)).toMatchObject({ x: 101, y: 110 });
      expect(savedAt(1)).toMatchObject({ x: 401, y: 110 });
    });
    expect(savedAt(2)).toMatchObject({ x: 100, y: 600 });
    await studio(lastSave()!);

    await user.keyboard("{Delete}");
    await waitFor(() =>
      expect(lastSave()?.items.map((item) => item.id)).toEqual([cat.id]),
    );
  });
});

describe("several selected", () => {
  beforeEach(() => {
    Element.prototype.setPointerCapture = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  type User = Awaited<ReturnType<typeof open>>["user"];
  // A click on a row with a key held: Shift, Control or Meta
  const toggle = async (user: User, name: RegExp, key = "Shift") => {
    await user.keyboard(`{${key}>}`);
    await user.click(row(name));
    await user.keyboard(`{/${key}}`);
  };
  const trash = () =>
    page().getAllByRole("button", { name: "Delete the selection" });
  const pressed = (name: RegExp) => row(name).getAttribute("aria-pressed");
  const shape = (
    label: string,
    patch: Partial<StudioElementOf<"shape">> = {},
  ) => elementOf("shape", { label, ...patch });

  it("toggles rows in and out with Shift, Ctrl or Cmd, and a plain click picks one", async () => {
    const { user } = await open(
      holding(shape("Ann"), shape("Bob"), group("Frame", [shape("Cal")])),
    );

    await user.click(row(/^Ann/));
    await toggle(user, /^Bob/);
    expect(pressed(/^Ann/)).toBe("true");
    expect(pressed(/^Bob/)).toBe("true");

    await toggle(user, /^Frame/, "Control");
    expect(pressed(/^Frame/)).toBe("true");
    await toggle(user, /^Bob/, "Meta");
    expect(pressed(/^Bob/)).toBe("false");
    expect(pressed(/^Frame/)).toBe("true");

    await user.click(row(/^Cal/));
    expect(pressed(/^Ann/)).toBe("false");
    expect(pressed(/^Frame/)).toBe("false");
    expect(pressed(/^Cal/)).toBe("true");
    expect(field("Name").getByRole("textbox")).toHaveValue("Cal");
  });

  it("takes a group's place for an element of it toggled in, and the other way", async () => {
    const { user } = await open(
      holding(shape("Ann"), group("Frame", [shape("Cal"), shape("Dee")])),
    );

    await user.click(row(/^Ann/));
    await toggle(user, /^Frame/);
    await toggle(user, /^Cal/);
    expect(pressed(/^Frame/)).toBe("false");
    expect(pressed(/^Cal/)).toBe("true");
    expect(pressed(/^Ann/)).toBe("true");

    await toggle(user, /^Dee/);
    await toggle(user, /^Frame/);
    expect(pressed(/^Frame/)).toBe("true");
    expect(pressed(/^Cal/)).toBe("false");
    expect(pressed(/^Dee/)).toBe("false");
  });

  it("deletes them all from the list, locked ones too, in one step", async () => {
    const ann = shape("Ann");
    const bob = shape("Bob", { locked: true });
    const cal = shape("Cal");
    const frame = group("Frame", [shape("Dee")]);
    const { user } = await open(holding(ann, frame, bob, cal));

    // Top = front: Cal, Bob, Frame, Dee, Ann
    await user.click(row(/^Bob/));
    await toggle(user, /^Frame/);
    // The Elements panel's trash, and the settings' own
    expect(trash()).toHaveLength(2);
    await user.keyboard("{Delete}");
    await waitFor(() => expect(savedIds()).toEqual([ann.id, cal.id]));
    // The row after the last one going takes the focus
    expect(row(/^Ann/)).toHaveFocus();

    await studio(lastSave()!);
    await user.click(undo());
    await waitFor(() =>
      expect(savedIds()).toEqual([
        ann.id,
        [frame.id, frame.elements[0].id],
        bob.id,
        cal.id,
      ]),
    );

    await studio(lastSave()!);
    await user.click(row(/^Ann/));
    await toggle(user, /^Cal/);
    await user.click(trash()[0]);
    await waitFor(() =>
      expect(savedIds()).toEqual([[frame.id, frame.elements[0].id], bob.id]),
    );
  });

  const key = (key: string) =>
    fireEvent.keyDown(document.body, { key, ctrlKey: true });

  it("copies them back to front, an element from a group on its own, and pastes them all", async () => {
    const ann = shape("Ann", { x: 100, y: 100 });
    const cal = shape("Cal", { x: 300, y: 300 });
    const frame = group("Frame", [shape("Bob"), cal]);
    const { user } = await open(holding(ann, frame));

    // Picked front first, taken back to front
    await user.click(row(/^Cal/));
    await toggle(user, /^Ann/);
    key("c");
    key("v");

    await waitFor(() => expect(lastSave()?.items).toHaveLength(4));
    const [annCopy, calCopy] = lastSave()!.items.slice(2);
    expect(annCopy).toEqual({ ...ann, id: annCopy.id, x: 120, y: 120 });
    expect(calCopy).toEqual({ ...cal, id: calCopy.id, x: 320, y: 320 });
    expect(savedGroup(1)?.elements).toHaveLength(2);
    // The copies are the selection
    expect(
      document.querySelector(`[data-select="${annCopy.id}"]`),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      document.querySelector(`[data-select="${calCopy.id}"]`),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("cuts them in one step, and pastes them where they were", async () => {
    const ann = shape("Ann", { x: 100, y: 100 });
    const frame = group("Frame", [shape("Bob", { x: 50, y: 50 })]);
    const { user } = await open(holding(ann, frame, shape("Cal")));

    await user.click(row(/^Ann/));
    await toggle(user, /^Frame/);
    key("x");
    await waitFor(() => expect(savedNames()).toEqual(["Cal"]));

    await studio(lastSave()!);
    key("v");
    await waitFor(() => expect(lastSave()?.items).toHaveLength(3));
    expect(lastSave()!.items[1]).toMatchObject({ label: "Ann", x: 100 });
    expect(groupIn(lastSave(), 2)?.elements[0]).toMatchObject({ x: 50 });

    await studio(lastSave()!);
    await user.click(undo());
    await waitFor(() => expect(savedNames()).toEqual(["Cal"]));
    await studio(lastSave()!);
    await user.click(undo());
    await waitFor(() => expect(savedIds()?.[0]).toBe(ann.id));
    expect(savedNames()).toEqual(["Ann", "Frame", "Cal"]);
  });

  const action = (name: string) => page().getByRole("button", { name });

  it("aligns them to each other, a group by its frame, the locked one staying, in one step", async () => {
    const ann = shape("Ann", { x: 100, y: 100, width: 100, height: 50 });
    const bob = shape("Bob", { x: 300, y: 400, width: 200, height: 100 });
    const cal = shape("Cal", { x: 500, y: 0, locked: true });
    const dee = shape("Dee", { x: 600, y: 50, width: 100, height: 100 });
    const { user } = await open(holding(ann, bob, cal, group("Frame", [dee])));

    await user.click(row(/^Ann/));
    await toggle(user, /^Bob/);
    await toggle(user, /^Cal/);
    expect(page().getByRole("heading", { name: "3 selected" })).toBeVisible();
    await user.click(
      field("Align to each other").getByRole("button", { name: "Align left" }),
    );
    await waitFor(() =>
      expect(lastSave()?.items.slice(0, 3)).toMatchObject([
        { x: 100 },
        { x: 100 },
        { x: 500 },
      ]),
    );
    await studio(lastSave()!);
    await user.click(undo());
    await waitFor(() =>
      expect(lastSave()?.items[1]).toMatchObject({ x: 300, y: 400 }),
    );

    // The group's elements move with it; the box around them is 600–700
    await studio(lastSave()!);
    await user.click(row(/^Ann/));
    await toggle(user, /^Frame/);
    await user.click(action("Align right"));
    await waitFor(() =>
      expect(lastSave()?.items[0]).toMatchObject({ x: 600, y: 100 }),
    );
    await user.click(action("Align top"));
    await waitFor(() => expect(lastSave()?.items[0]).toMatchObject({ y: 50 }));
    expect(savedGroup(3)?.elements[0]).toMatchObject({ x: 600, y: 50 });
  });

  it("spaces three or more evenly, across and down, in one step", async () => {
    const ann = shape("Ann", { x: 0, y: 0, width: 100, height: 100 });
    const bob = shape("Bob", { x: 150, y: 150, width: 100, height: 100 });
    const cal = shape("Cal", { x: 900, y: 1000, width: 100, height: 100 });
    const { user } = await open(holding(ann, bob, cal));

    await user.click(row(/^Ann/));
    await toggle(user, /^Cal/);
    const few = page().getAllByRole("button", {
      name: "Select 3 or more to space them evenly",
    });
    expect(few).toHaveLength(2);
    for (const button of few) expect(button).toBeDisabled();

    await toggle(user, /^Bob/);
    await user.click(action("Space evenly across"));
    await waitFor(() =>
      expect(lastSave()?.items[1]).toMatchObject({ x: 450, y: 150 }),
    );
    await user.click(action("Space evenly down"));
    await waitFor(() =>
      expect(lastSave()?.items[1]).toMatchObject({ x: 450, y: 500 }),
    );
    expect(lastSave()?.items[2]).toMatchObject({ x: 900, y: 1000 });

    await studio(lastSave()!);
    await user.click(undo());
    await waitFor(() =>
      expect(lastSave()?.items[1]).toMatchObject({ x: 450, y: 150 }),
    );
  });

  it("puts the elements in a new group where the front-most was, in one step", async () => {
    const ann = shape("Ann");
    const bob = shape("Bob");
    const cal = shape("Cal");
    const dee = shape("Dee");
    const frame = group("Group 1", [bob, cal]);
    const { user } = await open(holding(ann, frame, dee));

    await user.click(row(/^Dee/));
    await toggle(user, /^Bob/);
    await user.click(action("Put them in a new group"));

    await waitFor(() =>
      expect(savedIds()).toEqual([
        ann.id,
        [frame.id, cal.id],
        [lastSave()!.items[2].id, bob.id, dee.id],
      ]),
    );
    expect(savedNames()).toEqual(["Ann", "Group 1", "Group 2"]);
    // The new group is the selection
    expect(page().getByRole("heading", { name: "Group" })).toBeVisible();
    expect(field("Name").getByRole("textbox")).toHaveValue("Group 2");

    await studio(lastSave()!);
    await user.click(undo());
    await waitFor(() =>
      expect(savedIds()).toEqual([ann.id, [frame.id, bob.id, cal.id], dee.id]),
    );
  });

  it("doesn't group a group, as groups don't nest, and deletes them all", async () => {
    const ann = shape("Ann");
    const { user } = await open(holding(ann, group("Frame", [shape("Bob")])));

    await user.click(row(/^Ann/));
    await toggle(user, /^Frame/);
    expect(action("A group can't go inside another group")).toBeDisabled();

    await user.click(trash()[1]);
    await waitFor(() => expect(lastSave()?.items).toEqual([]));
    expect(
      page().getByRole("heading", { name: "Overlay settings" }),
    ).toBeVisible();
  });
});
