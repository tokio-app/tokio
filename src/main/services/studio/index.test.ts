import { StudioLayerSchema, StudioOverlay } from "@/common/schemas";
import {
  EMOTE_TRIGGER,
  GiftEvent,
  StudioNumbers,
  TOKIO_EVENTS,
  UserData,
} from "@/common/types";
import { describe, expect, it, vi } from "vitest";
import { StudioService } from "./index";

const NUMBERS: StudioNumbers = {
  likes: 1200,
  viewers: 30,
  followers: 2,
  shares: 1,
  coins: 99,
};

const user = (name: string, picture = `https://cdn/${name}.png`): UserData => ({
  username: name,
  handle: name.toLowerCase(),
  profilePictures: picture ? [picture] : [],
});

const layer = (id: string, patch: object) =>
  StudioLayerSchema.parse({
    id,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    kind: "shape",
    when: "event",
    ...patch,
  });

const overlayOf = (...layers: ReturnType<typeof layer>[]): StudioOverlay => ({
  id: "o1",
  name: "Main",
  size: "portrait",
  layers,
});

const gift = (count: number, repeatEnd: boolean, id = "5655"): GiftEvent => ({
  user: user("Ana"),
  gift: {
    id,
    coins: 1,
    repeatEnd,
    type: 1,
    name: "Rose",
    comboCount: count,
    image: "",
  },
});

const setup = () => {
  const studio = new StudioService();
  const onReact = vi.fn();
  studio.onReact(onReact);
  const numbers = vi.fn(() => NUMBERS);
  return { studio, onReact, numbers };
};

describe("StudioService", () => {
  it("fills a text layer's text with the event and the live numbers", () => {
    const { studio, onReact, numbers } = setup();
    const text = layer("t", {
      kind: "text",
      text: "Thanks {username}! {likes} likes",
      trigger: { type: TOKIO_EVENTS.FOLLOW, gifts: [] },
    });

    studio.handle(
      TOKIO_EVENTS.FOLLOW,
      { user: user("Ana") },
      [overlayOf(text)],
      numbers,
    );

    expect(onReact).toHaveBeenCalledWith("o1", {
      layer: "t",
      text: "Thanks Ana! 1.2K likes",
    });
  });

  it("sends a viewer layer the viewer's picture and name", () => {
    const { studio, onReact, numbers } = setup();
    const viewer = layer("v", { kind: "viewer" });

    studio.handle(
      TOKIO_EVENTS.FOLLOW,
      { user: user("Ana") },
      [overlayOf(viewer)],
      numbers,
    );
    studio.handle(
      TOKIO_EVENTS.FOLLOW,
      { user: { ...user("", ""), handle: "bo" } },
      [overlayOf(viewer)],
      numbers,
    );

    expect(onReact.mock.calls).toEqual([
      ["o1", { layer: "v", picture: "https://cdn/Ana.png", name: "Ana" }],
      ["o1", { layer: "v", picture: "", name: "bo" }],
    ]);
    // Only text layers read the numbers
    expect(numbers).not.toHaveBeenCalled();
  });

  it("leaves layers that are always on screen and other triggers alone", () => {
    const { studio, onReact, numbers } = setup();
    const always = layer("a", { when: "always" });
    const share = layer("s", {
      trigger: { type: TOKIO_EVENTS.SHARE, gifts: [] },
    });

    studio.handle(
      TOKIO_EVENTS.FOLLOW,
      { user: user("Ana") },
      [overlayOf(always, share)],
      numbers,
    );

    expect(onReact).not.toHaveBeenCalled();
  });

  it("reacts animate layers too, and matches emotes on chats", () => {
    const { studio, onReact, numbers } = setup();
    const animate = layer("m", {
      when: "animate",
      trigger: { type: EMOTE_TRIGGER, gifts: [] },
    });
    const chat = (emotes: number) => ({
      user: user("Ana"),
      comment: {
        content: "hi",
        lang: "en",
        emotes: Array.from({ length: emotes }, () => ({
          emoteID: "1",
          index: 0,
          images: [],
        })),
      },
    });

    studio.handle(TOKIO_EVENTS.CHAT, chat(0), [overlayOf(animate)], numbers);
    studio.handle(TOKIO_EVENTS.CHAT, chat(1), [overlayOf(animate)], numbers);

    expect(onReact.mock.calls).toEqual([["o1", { layer: "m" }]]);
  });

  it("reacts to a streak once, as it ends, with its total for every gift", () => {
    const { studio, onReact, numbers } = setup();
    const text = layer("t", {
      kind: "text",
      text: "{count}x {gift}",
      trigger: { type: TOKIO_EVENTS.GIFT, gifts: [] },
    });
    const overlays = [overlayOf(text)];

    studio.handle(TOKIO_EVENTS.GIFT, gift(1, false), overlays, numbers);
    studio.handle(TOKIO_EVENTS.GIFT, gift(3, false), overlays, numbers);
    studio.handle(TOKIO_EVENTS.GIFT, gift(3, true), overlays, numbers);

    expect(onReact.mock.calls).toEqual([
      ["o1", { layer: "t", text: "3x Rose" }],
    ]);
    expect(studio.kept(text)?.values).toMatchObject({
      gift: { comboCount: 3 },
    });
  });

  it("reacts on Like each time the likes pass another likes_every, once per event", () => {
    const { studio, onReact, numbers } = setup();
    const like = layer("l", {
      trigger: { type: TOKIO_EVENTS.LIKE, gifts: [] },
      likes_every: 10,
    });
    const likes = (likeCount: number) => ({
      user: user("Ana"),
      likeCount,
      totalLikes: 0,
    });
    const overlays = [overlayOf(like)];

    for (const count of [6, 3, 1, 25, 4]) {
      studio.handle(TOKIO_EVENTS.LIKE, likes(count), overlays, numbers);
    }

    // 6, 9, 10 (react), 25 (react, 5 left), 9
    expect(onReact).toHaveBeenCalledTimes(2);
  });

  it("keeps each layer's last event until its trigger changes", () => {
    const { studio, numbers } = setup();
    const text = layer("t", {
      kind: "text",
      text: "{username}",
      trigger: { type: TOKIO_EVENTS.FOLLOW, gifts: [] },
    });

    expect(studio.kept(text)).toBeNull();
    studio.handle(
      TOKIO_EVENTS.FOLLOW,
      { user: user("Ana") },
      [overlayOf(text)],
      numbers,
    );

    expect(studio.kept(text)).toMatchObject({
      picture: "https://cdn/Ana.png",
      name: "Ana",
      values: { user: { username: "Ana" } },
    });
    const shared = StudioLayerSchema.parse({
      ...text,
      trigger: { ...text.trigger, type: TOKIO_EVENTS.SHARE },
    });
    expect(studio.kept(shared)).toBeNull();
  });

  it("clears the streaks and like counts but keeps the values", () => {
    const { studio, onReact, numbers } = setup();
    const like = layer("l", {
      trigger: { type: TOKIO_EVENTS.LIKE, gifts: [] },
      likes_every: 10,
    });
    const overlays = [overlayOf(like)];
    const likes = { user: user("Ana"), likeCount: 6, totalLikes: 0 };

    studio.handle(
      TOKIO_EVENTS.LIKE,
      { ...likes, likeCount: 10 },
      overlays,
      numbers,
    );
    studio.handle(TOKIO_EVENTS.LIKE, likes, overlays, numbers);
    studio.clear();
    studio.handle(TOKIO_EVENTS.LIKE, likes, overlays, numbers);

    expect(onReact).toHaveBeenCalledTimes(1);
    expect(studio.kept(like)).not.toBeNull();
  });

  it("forgets a removed overlay's layers", () => {
    const { studio, numbers } = setup();
    const a = layer("a", {});
    const b = layer("b", {});
    const follow = { user: user("Ana") };

    studio.handle(TOKIO_EVENTS.FOLLOW, follow, [overlayOf(a)], numbers);
    studio.handle(
      TOKIO_EVENTS.FOLLOW,
      follow,
      [{ ...overlayOf(b), id: "o2" }],
      numbers,
    );
    studio.forget("o1");

    expect(studio.kept(a)).toBeNull();
    expect(studio.kept(b)).not.toBeNull();
  });

  it("tests every layer that reacts with samples, keeping none", () => {
    const { studio, onReact } = setup();
    const text = layer("t", {
      kind: "text",
      text: "{username} {viewers}",
      trigger: { type: EMOTE_TRIGGER, gifts: [] },
    });
    const viewer = layer("v", { kind: "viewer" });
    const always = layer("a", { when: "always" });

    const reacts = studio.test(overlayOf(text, viewer, always), NUMBERS);

    expect(reacts).toHaveLength(2);
    expect(reacts[0]).toEqual({
      layer: "t",
      text: expect.stringMatching(/^\S.* 30$/),
    });
    expect(reacts[1]).toMatchObject({
      layer: "v",
      picture: expect.stringMatching(/^https:/),
      name: expect.any(String),
    });
    expect(onReact).not.toHaveBeenCalled();
    expect(studio.kept(text)).toBeNull();
    expect(studio.kept(viewer)).toBeNull();
  });
});
