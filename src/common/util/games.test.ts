import { describe, expect, it } from "vitest";
import {
  GameAction,
  GameActionSchema,
  GamesOverlaySchema,
  Profile,
} from "../schemas/profile";
import { EMOTE_TRIGGER, TOKIO_EVENTS } from "../types/connector";
import { CustomGift } from "../types/overlay";
import { gameEventPictures, gameEventText, gameOverlayRows } from "./games";

const gift = (value: number, label: string, img = `${label}.png`) =>
  ({ value, label, img, coins: 1 }) satisfies CustomGift;

const gifts = [gift(5655, "Rose"), gift(6369, "Lion"), gift(1, "Bare", "")];
const emotes = [{ id: "e1", image: "e1.png" }];
const picture = { name: "TNT", file: "abc.png" };

// A Follow action shown with a picture, unless changed
const action = (
  change: (a: GameAction) => void = () => {},
  type: GameAction["trigger"]["type"] = TOKIO_EVENTS.FOLLOW,
): GameAction => {
  const a = GameActionSchema.parse({
    id: "a1",
    enabled: true,
    trigger: { type, gifts: [] },
    steps: [],
    overlay: { image: picture },
  });
  change(a);
  return a;
};

const games = (actions: GameAction[], columns = 1): Profile["games"] => ({
  actions,
  overlay: GamesOverlaySchema.parse({ columns }),
});

const sources = {
  gifts,
  emotes,
  mediaURL: (file: string) => `/games/minecraft/pictures/${file}`,
};

const rows = (...actions: GameAction[]) =>
  gameOverlayRows(games(actions), sources);

describe("gameOverlayRows", () => {
  it("gives each shown action its event, picture and name, in order", () => {
    const tnt = action((a) => {
      a.id = "tnt";
      a.trigger.gifts = [5655];
      a.overlay.name = " TNT ";
    }, TOKIO_EVENTS.GIFT);
    const zombie = action((a) => {
      a.id = "zombie";
      a.overlay = {
        show: true,
        image: null,
        event: "",
        name: "Zombie",
        column: 1,
      };
    });

    expect(rows(tnt, zombie)).toEqual([
      {
        id: "tnt",
        pictures: ["Rose.png"],
        event: "Rose",
        image: "/games/minecraft/pictures/abc.png",
        name: "TNT",
        column: 1,
      },
      {
        id: "zombie",
        pictures: [],
        event: "Follow",
        image: null,
        name: "Zombie",
        column: 1,
      },
    ]);
  });

  it("leaves out actions that are off, hidden, or have no picture or name", () => {
    const off = action((a) => (a.enabled = false));
    const hidden = action((a) => (a.overlay.show = false));
    const empty = action((a) => {
      a.overlay.image = null;
      a.overlay.name = "  ";
    });

    expect(rows(off, hidden, empty)).toEqual([]);
  });

  it("puts each action in its column, the last one when there are fewer", () => {
    const first = action((a) => (a.id = "first"));
    const third = action((a) => {
      a.id = "third";
      a.overlay.column = 3;
    });

    const columns = (count: number) =>
      gameOverlayRows(games([first, third], count), sources).map(
        (row) => row.column,
      );

    expect(columns(4)).toEqual([1, 3]);
    expect(columns(2)).toEqual([1, 2]);
    expect(columns(1)).toEqual([1, 1]);
  });

  it("uses the streamer's event text, trimmed, over the gift's name", () => {
    const rose = action((a) => {
      a.trigger.gifts = [5655];
      a.overlay.event = " Rosa ";
    }, TOKIO_EVENTS.GIFT);

    expect(rows(rose)[0]).toMatchObject({
      event: "Rosa",
      pictures: ["Rose.png"],
    });
  });
});

describe("gameEventText", () => {
  const text = (a: GameAction) => gameEventText(a, gifts);

  it("names the gifts, or any gift when none are picked", () => {
    const giftAction = (ids: number[]) =>
      action((a) => (a.trigger.gifts = ids), TOKIO_EVENTS.GIFT);

    expect(text(giftAction([5655, 6369]))).toBe("Rose or Lion");
    expect(text(giftAction([]))).toBe("Any gift");
    // Until the gift lists load
    expect(text(giftAction([42]))).toBe("Gift");
  });

  it("counts the likes", () => {
    const likes = (n: number) =>
      action((a) => (a.likes_every = n), TOKIO_EVENTS.LIKE);

    expect(text(likes(100))).toBe("100 likes");
    expect(text(likes(1))).toBe("1 like");
  });

  it("quotes chat's keyword, as the timer's carousel does", () => {
    const chat = (keyword: string) =>
      action((a) => (a.trigger.keyword = keyword), TOKIO_EVENTS.CHAT);

    expect(text(chat(" tnt "))).toBe("Chat “tnt”");
    expect(text(chat(""))).toBe("Chat");
  });

  it("gives other events their trigger's label", () => {
    expect(text(action())).toBe("Follow");
    expect(text(action(() => {}, TOKIO_EVENTS.SUPER_FAN))).toBe("Super Fan");
  });
});

describe("gameEventPictures", () => {
  it("shows the gifts' pictures, up to 3, skipping gifts without one", () => {
    const many = action(
      (a) => (a.trigger.gifts = [1, 5655, 6369, 5655, 6369]),
      TOKIO_EVENTS.GIFT,
    );

    expect(gameEventPictures(many, gifts, emotes)).toEqual([
      "Rose.png",
      "Lion.png",
      "Rose.png",
    ]);
  });

  it("takes the first entry of a gift listed twice, TikTok's", () => {
    const rose = action((a) => (a.trigger.gifts = [5655]), TOKIO_EVENTS.GIFT);
    const both = [
      gift(5655, "Rose", "tiktok.png"),
      gift(5655, "Rose", "x.png"),
    ];

    expect(gameEventPictures(rose, both, emotes)).toEqual(["tiktok.png"]);
  });

  it("shows the emotes' pictures, and none for other events", () => {
    const emote = action(
      (a) => (a.trigger.emotes = ["e1", "gone"]),
      EMOTE_TRIGGER,
    );

    expect(gameEventPictures(emote, gifts, emotes)).toEqual(["e1.png"]);
    expect(gameEventPictures(action(), gifts, emotes)).toEqual([]);
  });
});
