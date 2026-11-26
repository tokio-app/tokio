// Overlay Studio's editor: what elements show and react to, the profile's
// platforms, effects and animations, counters, tests and media files
import { GOAL_TRIGGER, TriggerSchema } from "@/common/schemas";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  Platform,
  TOKIO_EVENTS,
} from "@/common/types";
import { createAction, createAlert } from "@/common/util";
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
  page,
  row,
  rowOf,
  canvas,
  drawn,
  field,
  addItems,
  addMenu,
  sized,
  handle,
} from "@test/studio";

describe("StudioEditor", () => {
  beforeEach(() => {
    Element.prototype.setPointerCapture = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  describe("on the profile's platforms", () => {
    const usingPlatforms = (platforms: Platform[]) =>
      send(
        APP_EVENTS_RESPONSE.GET_PROFILE,
        profileReply((p) => {
          p.platforms = platforms;
        }),
      );

    it("adds a Gift element only where gifts come", async () => {
      const { user } = await open(holding());
      // Twitch sends none, Kick sends Kicks
      await usingPlatforms(["twitch", "kick"]);
      await user.click(addMenu());
      expect(addItems().queryByRole("button", { name: "Gift" })).toBeNull();
      expect(addItems().getByRole("button", { name: "Emote" })).toBeVisible();
      await user.keyboard("{Escape}");

      await usingPlatforms(["youtube"]);
      await user.click(addMenu());
      expect(addItems().getByRole("button", { name: "Gift" })).toBeVisible();
    });

    it("picks from TikTok's gifts only with TikTok, or to change one picked", async () => {
      const sent = elementOf("gift", { label: "Sent" });
      const picked = elementOf("gift", { label: "Picked", gift: 5655 });
      const { user } = await open(scene(sent, picked));
      await usingPlatforms(["youtube"]);

      await user.click(row(/^Sent/));
      expect(
        page().getByRole("radio", { name: "The gift a viewer sends" }),
      ).toBeChecked();
      expect(
        page().queryByRole("radio", { name: "A gift you pick" }),
      ).toBeNull();

      await user.click(row(/^Picked/));
      expect(
        page().getByRole("radio", { name: "A gift you pick" }),
      ).toBeChecked();
    });

    it("picks from the emotes of the profile's platforms", async () => {
      const element = elementOf("emote");
      const { user } = await open(scene(element));
      await usingPlatforms(["kick"]);
      await send(APP_EVENTS_RESPONSE.EMOTES, {
        data: [
          { id: "7001", image: "https://x/7001.png" },
          {
            id: "kick:37226",
            image: "https://files.kick.com/emotes/37226/fullsize",
          },
        ],
      });
      await user.click(row(/^Emote/));

      await user.click(
        page().getByRole("radio", { name: "An emote you pick" }),
      );

      // TikTok's comes first, but the profile has only Kick
      await waitFor(() =>
        expect(savedElement()).toMatchObject({
          emote: { id: "kick:37226" },
        }),
      );
    });

    it("lists followers and gifts only from platforms that send them", async () => {
      const list = elementOf("list", { source: "gifts" });
      const { user } = await open(holding(list));
      await usingPlatforms(["twitch"]);
      await user.click(row(/^Latest gifts/));

      await user.click(field("Shows").getByText("Latest gifts"));
      const shows = page().getByRole("group", { name: "Shows" });
      expect(inList(shows, "New followers")).toBeTruthy();
      // Twitch sends no gifts, but the saved source stays to change
      expect(inList(shows, "Latest gifts")).toBeTruthy();
      await user.keyboard("{Escape}");

      await usingPlatforms(["kick"]);
      await user.click(field("Shows").getByText("Latest gifts"));
      expect(inList(shows, "New followers")).toBeNull();
      await user.click(inList(shows, "Chat")!);
      await waitFor(() =>
        expect(lastSave()?.items[0]).toMatchObject({ source: "chat" }),
      );
      await user.click(field("Shows").getByText("Chat"));
      expect(inList(shows, "Latest gifts")).toBeNull();
    });
  });

  it("turns a shape's fill off and a border on", async () => {
    const shape = elementOf("shape");
    const { user } = await open(scene(shape));
    await user.click(row(/^Rectangle/));

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

  it("fades a shape's fill into a gradient, offered only with a fill", async () => {
    const shape = elementOf("shape");
    const { user } = await open(scene(shape));
    await user.click(row(/^Rectangle/));

    await user.click(page().getByRole("checkbox", { name: "Gradient" }));
    const angle = page().getByRole("spinbutton", { name: "Gradient angle" });
    await user.clear(angle);
    await user.type(angle, "45");
    await waitFor(() =>
      expect(savedElement()).toMatchObject({
        gradient: true,
        gradient_angle: 45,
      }),
    );
    expect(drawn(shape.id).classList).toContain("studio-gradient");

    await user.click(page().getByRole("checkbox", { name: "Fill" }));
    expect(
      page().queryByRole("checkbox", { name: "Gradient" }),
    ).not.toBeInTheDocument();
  });

  it("gives any kind a shadow and a blur", async () => {
    const element = elementOf("emote");
    const { user } = await open(scene(element));
    await user.click(row(/^Emote/));

    const shadow = within(page().getByRole("group", { name: "Shadow" }));
    expect(shadow.queryByRole("spinbutton")).not.toBeInTheDocument();
    await user.click(shadow.getByRole("checkbox", { name: "Shadow" }));
    const softness = shadow.getByRole("spinbutton", { name: "Softness" });
    await user.clear(softness);
    await user.type(softness, "30");
    const down = shadow.getByRole("spinbutton", { name: "Y" });
    await user.clear(down);
    await user.type(down, "-12");
    const blur = page().getByRole("spinbutton", { name: "Blur" });
    await user.clear(blur);
    await user.type(blur, "6");

    await waitFor(() =>
      expect(savedElement()).toMatchObject({
        shadow: true,
        shadow_blur: 30,
        shadow_y: -12,
        blur: 6,
      }),
    );
    expect(drawn(element.id).style.filter).toMatch(
      /^blur\(6px\) drop-shadow\(0px -12px 30px/,
    );
  });

  it("offers a viewer's picture only the event Whens", async () => {
    const { user } = await open(scene(elementOf("viewer")));

    await user.click(row(/^Viewer's picture/));

    for (const name of ["Always on screen", "Moves all the time"]) {
      expect(page().queryByRole("radio", { name })).not.toBeInTheDocument();
    }
    expect(
      page().getByRole("radio", { name: "Shows on an event" }),
    ).toBeChecked();
  });

  // Picks an option of a field's Select
  const pick = async (
    user: Awaited<ReturnType<typeof open>>["user"],
    label: string,
    from: string,
    to: string,
  ) => {
    const select = page().getByRole("group", { name: label });
    await user.click(within(select).getByText(from));
    await user.click(inList(select, to)!);
  };

  it("picks an entrance and an exit, an animation, and a loop", async () => {
    const element = text({ text: "Hello" });
    const { user } = await open(scene(element));
    await user.click(row(/^Hello/));

    await user.click(page().getByRole("radio", { name: "Shows on an event" }));
    await pick(user, "Entrance", "Pop", "Drop");
    await pick(user, "Exit", "Fade", "Zoom");
    await waitFor(() =>
      expect(savedElement()).toMatchObject({ entrance: "drop", exit: "zoom" }),
    );

    await user.click(page().getByRole("radio", { name: "Moves on an event" }));
    expect(page().queryByRole("group", { name: "Exit" })).toBeNull();
    await pick(user, "Animation", "Bounce", "Ta-da");
    await waitFor(() =>
      expect(savedElement()).toMatchObject({
        when: "animate",
        animation: "tada",
      }),
    );

    // No trigger: it moves with or without the LIVE
    await user.click(page().getByRole("radio", { name: "Moves all the time" }));
    expect(page().queryByRole("group", { name: "Trigger" })).toBeNull();
    expect(
      page().queryByRole("group", { name: "Seconds on screen" }),
    ).toBeNull();
    await pick(user, "Animation", "Float", "Sway");
    await waitFor(() =>
      expect(savedElement()).toMatchObject({ when: "loop", idle: "sway" }),
    );
    expect(row(/^Hello/)).toHaveTextContent("Text, moves all the time");
    // Only screen readers hear that it moves all the time
    expect(
      rowOf(/^Hello/).queryByText("Moves all the time", {
        selector: "[class*=layer_when]",
      }),
    ).toBeNull();
  });

  it("makes a group react to an event, its row saying it", async () => {
    const { user } = await open(scene(text({ text: "Hello" })));
    await user.click(row(/^Group 1/));

    await user.click(page().getByRole("radio", { name: "Shows on an event" }));
    // A group has no video of its own to wait for
    expect(field("Seconds on screen").getByRole("spinbutton")).toHaveValue(5);
    await pick(user, "Exit", "Fade", "Blur");
    await pick(user, "Trigger", "Follow", "Like");
    const likes = field("Trigger").getByRole("spinbutton", {
      name: "Likes per reaction",
    });
    await user.clear(likes);
    await user.type(likes, "50");
    const seconds = field("Seconds on screen").getByRole("spinbutton");
    await user.clear(seconds);
    await user.type(seconds, "8");

    await waitFor(() =>
      expect(savedGroup(0)).toMatchObject({
        when: "event",
        trigger: { type: TOKIO_EVENTS.LIKE },
        likes_every: 50,
        seconds: 8,
        exit: "blur",
      }),
    );
    // Its elements keep their own
    expect(savedElement()).toMatchObject({ when: "always" });
    expect(
      rowOf(/^Group 1/).getByText("Shows on Like", {
        selector: "[class*=layer_when]",
      }),
    ).toBeVisible();
    expect(row(/^Group 1/)).toHaveAccessibleName(/Shows on Like/);

    // A gift trigger picks from the gifts
    await send(APP_EVENTS_RESPONSE.GET_GIFTS, {
      data: [gift(5655, "Rose")],
    });
    await pick(user, "Trigger", "Like", "Gift");
    await user.click(field("Trigger").getByText("Any gift"));
    expect(
      inList(page().getByRole("group", { name: "Trigger" }), "Rose"),
    ).not.toBeNull();
    await user.keyboard("{Escape}");

    await user.click(page().getByRole("radio", { name: "Moves all the time" }));
    await waitFor(() => expect(savedGroup(0)).toMatchObject({ when: "loop" }));
    expect(
      rowOf(/^Group 1/).queryByText(/Moves/, {
        selector: "[class*=layer_when]",
      }),
    ).toBeNull();
  });

  it("turns a gift that moves all the time to show on its event when it shows what's sent", async () => {
    const element = elementOf("gift", { gift: 5655, when: "loop" });
    const { user } = await open(scene(element));
    await send(APP_EVENTS_RESPONSE.GET_GIFTS, {
      data: [gift(5655, "Rose")],
    });
    await user.click(row(/^Rose/));
    expect(
      page().getByRole("radio", { name: "Moves all the time" }),
    ).toBeChecked();

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
      page().queryByRole("radio", { name: "Moves all the time" }),
    ).not.toBeInTheDocument();
  });

  it("waits its delay in seconds before it shows or moves", async () => {
    const { user } = await open(scene(elementOf("shape")));
    await user.click(row(/^Rectangle/));

    await user.click(page().getByRole("radio", { name: "Shows on an event" }));
    const delay = field("Delay (s)").getByRole("spinbutton");
    expect(delay).toHaveValue(0);
    await user.clear(delay);
    await user.type(delay, "1.5");
    await waitFor(() => expect(savedElement()).toMatchObject({ delay: 1.5 }));

    await user.click(page().getByRole("radio", { name: "Moves on an event" }));
    expect(field("Delay (s)").getByRole("spinbutton")).toHaveValue(1.5);
    await user.click(page().getByRole("radio", { name: "Moves all the time" }));
    expect(page().queryByRole("group", { name: "Delay (s)" })).toBeNull();
  });

  it("adds, retypes and removes trigger rows, each saved as the schema shapes it", async () => {
    const counter = {
      name: "roses",
      trigger: TriggerSchema.parse({ type: TOKIO_EVENTS.GIFT, gifts: [] }),
    };
    const { user } = await open(
      studioOverlay("Main", {
        id: ID,
        counters: [counter],
        items: [group("Group 1", [elementOf("shape", { when: "event" })])],
      }),
    );
    await user.click(row(/^Rectangle/));
    const add = page().getByRole("button", { name: "Add a trigger" });

    await user.click(add);
    await waitFor(() =>
      expect(savedElement()?.also_triggers).toEqual([
        TriggerSchema.parse({ type: TOKIO_EVENTS.FOLLOW, gifts: [] }),
      ]),
    );
    await pick(user, "Trigger 2", "Follow", "Gift");
    await waitFor(() =>
      expect(savedElement()?.also_triggers).toEqual([
        TriggerSchema.parse({ type: TOKIO_EVENTS.GIFT, gifts: [] }),
      ]),
    );
    expect(row(/^Rectangle/)).toHaveTextContent(
      "Shape, shows on Follow or Gift",
    );

    // A goal watches a LIVE number the profile's platforms fill, but the
    // LIVE's length, or a counter
    await pick(user, "Trigger 2", "Gift", "Goal reached");
    await waitFor(() =>
      expect(savedElement()?.also_triggers).toEqual([
        { type: GOAL_TRIGGER, number: "likes", goal: 1000 },
      ]),
    );
    const goal = page().getByRole("group", { name: "Trigger 2" });
    await user.click(within(goal).getByText("{likes}"));
    expect(inList(goal, "{coins}")).not.toBeNull();
    expect(inList(goal, "{uptime}")).toBeNull();
    expect(inList(goal, "{kicks}")).toBeNull();
    expect(inList(goal, "{bits}")).toBeNull();
    await user.click(inList(goal, "{roses}")!);
    const value = within(goal).getByRole("spinbutton", { name: "Goal" });
    await user.clear(value);
    await user.type(value, "500");
    await waitFor(() =>
      expect(savedElement()?.also_triggers).toEqual([
        { type: GOAL_TRIGGER, number: "roses", goal: 500 },
      ]),
    );
    expect(row(/^Rectangle/)).toHaveTextContent(
      "Shape, shows on Follow or Goal reached",
    );

    // Back to an event, with the schema's defaults
    await pick(user, "Trigger 2", "Goal reached", "Chat");
    await waitFor(() =>
      expect(savedElement()?.also_triggers).toEqual([
        TriggerSchema.parse({ type: TOKIO_EVENTS.CHAT, gifts: [] }),
      ]),
    );

    // Five in all
    for (let i = 0; i < 3; i++) await user.click(add);
    expect(add).toBeDisabled();
    await waitFor(() => expect(savedElement()?.also_triggers).toHaveLength(4));
    await user.click(page().getByRole("button", { name: "Remove trigger 2" }));
    await waitFor(() => expect(savedElement()?.also_triggers).toHaveLength(3));
    expect(savedElement()?.also_triggers[0]).toMatchObject({
      type: TOKIO_EVENTS.FOLLOW,
    });
    expect(add).toBeEnabled();
  });

  it("shows the Likes per reaction once, with the first Like row", async () => {
    const like = TriggerSchema.parse({ type: TOKIO_EVENTS.LIKE, gifts: [] });
    const { user } = await open(
      scene(
        elementOf("shape", {
          when: "event",
          trigger: like,
          also_triggers: [like],
        }),
      ),
    );
    await user.click(row(/^Rectangle/));

    expect(
      page().getAllByRole("spinbutton", { name: "Likes per reaction" }),
    ).toHaveLength(1);
    expect(
      field("Trigger").getByRole("spinbutton", { name: "Likes per reaction" }),
    ).toBeVisible();
  });

  it("holds a reaction to a minimum in its event's unit, as an alert's", async () => {
    const { user } = await open(
      scene(
        elementOf("shape", {
          when: "event",
          trigger: TriggerSchema.parse({ type: TOKIO_EVENTS.CHEER, gifts: [] }),
          also_triggers: [
            TriggerSchema.parse({ type: TOKIO_EVENTS.FOLLOW, gifts: [] }),
          ],
        }),
      ),
    );
    await user.click(row(/^Rectangle/));

    // Bits have one, in Bits; a follow none
    const minimum = field("Worth at least");
    expect(minimum.getByText("Bits")).toBeVisible();
    expect(
      page().getAllByRole("spinbutton", { name: "Worth at least" }),
    ).toHaveLength(1);
    const input = minimum.getByRole("spinbutton");
    await user.clear(input);
    await user.type(input, "100");

    await waitFor(() =>
      expect(savedElement()).toMatchObject({
        trigger: { type: TOKIO_EVENTS.CHEER, min_coins: 100 },
        also_triggers: [{ type: TOKIO_EVENTS.FOLLOW, min_coins: 0 }],
      }),
    );
  });

  it("offers a viewer's extra rows only the events a viewer sends, and no goal", async () => {
    const { user } = await open(scene(elementOf("viewer")));
    await user.click(row(/^Viewer's picture/));

    const first = page().getByRole("group", { name: "Trigger" });
    await user.click(within(first).getByText("Follow"));
    expect(inList(first, "Goal reached")).toBeNull();
    await user.keyboard("{Escape}");

    await user.click(page().getByRole("button", { name: "Add a trigger" }));
    const other = page().getByRole("group", { name: "Trigger 2" });
    await user.click(within(other).getByRole("combobox"));
    expect(inList(other, "Gift")).not.toBeNull();
    for (const name of ["Envelope", "Super Fan Box", "Music change"]) {
      expect(inList(other, name)).toBeNull();
    }
    expect(inList(other, "Goal reached")).toBeNull();
  });

  it("keeps one trigger for a gift that shows what's sent", async () => {
    const element = elementOf("gift", {
      gift: 5655,
      when: "event",
      also_triggers: [
        TriggerSchema.parse({ type: TOKIO_EVENTS.FOLLOW, gifts: [] }),
      ],
    });
    const { user } = await open(scene(element));
    await send(APP_EVENTS_RESPONSE.GET_GIFTS, {
      data: [gift(5655, "Rose")],
    });
    await user.click(row(/^Rose/));
    expect(page().getByRole("group", { name: "Trigger 2" })).toBeVisible();

    await user.click(
      page().getByRole("radio", { name: "The gift a viewer sends" }),
    );

    await waitFor(() =>
      expect(savedElement()).toMatchObject({
        gift: null,
        trigger: { type: TOKIO_EVENTS.GIFT },
        also_triggers: [],
      }),
    );
    expect(page().queryByRole("group", { name: "Trigger 2" })).toBeNull();
    expect(
      page().queryByRole("button", { name: "Add a trigger" }),
    ).not.toBeInTheDocument();
  });

  it("gives a group the same rows, a goal included", async () => {
    const { user } = await open(scene(text({ text: "Hello" })));
    await user.click(row(/^Group 1/));
    await user.click(page().getByRole("radio", { name: "Moves on an event" }));

    await user.click(page().getByRole("button", { name: "Add a trigger" }));
    await pick(user, "Trigger 2", "Follow", "Goal reached");
    const value = field("Trigger 2").getByRole("spinbutton", { name: "Goal" });
    await user.clear(value);
    await user.type(value, "20");

    await waitFor(() =>
      expect(savedGroup(0)).toMatchObject({
        when: "animate",
        also_triggers: [{ type: GOAL_TRIGGER, number: "likes", goal: 20 }],
      }),
    );
    expect(row(/^Group 1/)).toHaveAccessibleName(
      /Moves on Follow or Goal reached/,
    );
  });

  it("adds, names, retypes and removes counters, warning about their names", async () => {
    const { user } = await open(studioOverlay("Main", { id: ID }));
    const counters = () => lastSave()?.counters;
    expect(page().getByText(/^Count an event during each LIVE/)).toBeVisible();

    const add = page().getByRole("button", { name: "Add a counter" });
    await user.click(add);
    await waitFor(() =>
      expect(counters()).toEqual([
        {
          name: "",
          trigger: TriggerSchema.parse({ type: TOKIO_EVENTS.GIFT, gifts: [] }),
        },
      ]),
    );
    const first = field("Counter 1");
    const name = first.getByRole("textbox", { name: "Name" });
    expect(name).toHaveAccessibleDescription("Name it to show it in a text.");

    // Only what a text's {name} finds
    await user.type(name, "big roses!");
    await waitFor(() => expect(counters()?.[0].name).toBe("bigroses"));
    expect(first.queryByText(/Name it/)).toBeNull();
    await pick(user, "Counter 1", "Gift", "Follow");
    await waitFor(() =>
      expect(counters()?.[0].trigger).toEqual(
        TriggerSchema.parse({ type: TOKIO_EVENTS.FOLLOW, gifts: [] }),
      ),
    );

    await user.click(add);
    const second = field("Counter 2").getByRole("textbox", { name: "Name" });
    await user.type(second, "bigroses");
    expect(second).toHaveAccessibleDescription(
      "Another counter has this name. Texts show only one of them.",
    );
    expect(name).toHaveAccessibleDescription(/Another counter/);
    await user.clear(second);
    await user.type(second, "likes");
    expect(second).toHaveAccessibleDescription(
      /^A LIVE number or an event's value already has this name/,
    );
    await user.clear(second);
    await user.type(second, "username");
    expect(second).toHaveAccessibleDescription(/already has this name/);
    // Warned, never refused
    await waitFor(() => expect(counters()?.[1].name).toBe("username"));

    await user.click(page().getByRole("button", { name: "Remove counter 1" }));
    await waitFor(() =>
      expect(counters()?.map((c) => c.name)).toEqual(["username"]),
    );
  });

  it("lists the overlay's counters with the LIVE numbers, filled with samples", async () => {
    const element = text({ text: "{roses} roses" });
    const { user } = await open(
      studioOverlay("Main", {
        id: ID,
        counters: [
          {
            name: "roses",
            trigger: TriggerSchema.parse({
              type: TOKIO_EVENTS.GIFT,
              gifts: [],
            }),
          },
        ],
        items: [group("Group 1", [element])],
      }),
    );

    expect(drawn(element.id)).toHaveTextContent("12 roses");
    await user.click(row(/roses/));
    const live = within(page().getByText("LIVE numbers:").closest("p")!);
    expect(live.getByTitle("Insert {likes}")).toBeVisible();
    expect(live.getByTitle("Insert {roses}")).toBeVisible();
  });

  it("tests each element and group after its own delay, the wait starting over with each Test", async () => {
    const now = text({ text: "Now", when: "event" });
    const later = text({ text: "Later", when: "event", delay: 2 });
    const moves = group("Moves", [text({ text: "Other" })], {
      when: "animate",
      delay: 1,
    });
    await open(holding(group("Group 1", [now, later]), moves));
    const entered = (id: string) =>
      /studio-enter-/.test(drawn(id).querySelector(".studio-body")!.className);
    const played = () =>
      /studio-play-/.test(
        canvas().querySelector<HTMLElement>(
          `.studio-layer[data-layer="${moves.id}"] .studio-group`,
        )!.className,
      );
    const testButton = page().getByRole("button", {
      name: "Test the elements and groups that react to events",
    });

    vi.useFakeTimers();
    try {
      fireEvent.click(testButton);
      expect(entered(now.id)).toBe(true);
      expect(entered(later.id)).toBe(false);
      expect(played()).toBe(false);

      act(() => vi.advanceTimersByTime(1000));
      expect(played()).toBe(true);
      expect(entered(later.id)).toBe(false);

      // Another Test clears the waits the last one left
      fireEvent.click(testButton);
      act(() => vi.advanceTimersByTime(1500));
      expect(entered(later.id)).toBe(false);
      act(() => vi.advanceTimersByTime(500));
      expect(entered(later.id)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("measures a text's words with every motion on the stage held still", async () => {
    const words = text({
      text: "Hello",
      when: "loop",
      width: 600,
      height: 300,
    });
    const { user } = await open(
      holding(group("Group 1", [words], { when: "loop" })),
    );
    await user.click(row(/^Hello/));
    sized();
    const root = canvas().querySelector<HTMLElement>(".studio-stage")!;
    const still: boolean[] = [];
    vi.spyOn(Range.prototype, "getBoundingClientRect").mockImplementation(
      () => {
        still.push(/measuring/.test(root.className));
        return new DOMRect(0, 0, 300, 60);
      },
    );

    fireEvent.pointerDown(handle("se"), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(canvas(), { clientX: 0, clientY: -500 });
    fireEvent.pointerUp(canvas());

    await waitFor(() => expect(savedElement()).toMatchObject({ height: 120 }));
    expect(still.length).toBeGreaterThan(0);
    expect(still.every(Boolean)).toBe(true);
    expect(root.className).not.toMatch(/measuring/);
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
        name: "Test the elements and groups that react to events",
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

  it("offers Test only while something reacts to an event", async () => {
    const shown = text({ text: "Hello" });
    const { user } = await open(scene(shown));
    const test = () =>
      page().getByRole("button", {
        name: "Test the elements and groups that react to events",
      });
    expect(test()).toBeDisabled();

    await user.click(row(/^Hello/));
    // When comes right after the name, before the text it gives variables to
    const [name, when, words] = ["Name", "When", "Text"].map((label) =>
      page().getByRole("group", { name: label }),
    );
    expect(name.nextElementSibling).toBe(when);
    expect(when.compareDocumentPosition(words)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    await user.click(
      field("When").getByRole("radio", { name: "Shows on an event" }),
    );
    expect(test()).toBeEnabled();
  });

  it("tests the groups that react too, not a hidden one", async () => {
    const shows = group("Shows", [text({ text: "One" })], {
      when: "event",
      entrance: "zoom",
    });
    const moves = group("Moves", [text({ text: "Two" })], {
      when: "animate",
      animation: "jelly",
    });
    const hidden = group("Hidden", [text({ text: "Three" })], {
      when: "event",
      hidden: true,
    });
    const loops = group("Loops", [text({ text: "Four" })], {
      when: "loop",
      idle: "hop",
    });
    const { user } = await open(holding(shows, moves, hidden, loops));
    const mover = (id: string) =>
      canvas().querySelector<HTMLElement>(
        `.studio-layer[data-layer="${id}"] .studio-group`,
      );
    // A group that waits for its event keeps its dashed outline
    expect(mover(shows.id)!.className).toMatch(/studio-waits/);
    expect(mover(loops.id)!.className).toMatch(/studio-loop-hop/);

    await user.click(
      page().getByRole("button", {
        name: "Test the elements and groups that react to events",
      }),
    );

    expect(mover(shows.id)!.className).toMatch(/studio-enter-zoom/);
    expect(mover(moves.id)!.className).toMatch(/studio-play-jelly/);
    expect(mover(hidden.id)).toBeNull();
    expect(mover(loops.id)!.className).not.toMatch(/studio-(enter|play)-/);
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
    expect(screen.getAllByText("Countdown").length).toBeGreaterThan(0);
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
