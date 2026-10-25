import { describe, expect, it } from "vitest";
import {
  GameAction,
  GameActionSchema,
  GamesOverlaySchema,
  Profile,
} from "../schemas/profile";
import { EMOTE_TRIGGER, TOKIO_EVENTS } from "../types/connector";
import { CustomGift } from "../types/overlay";
import {
  gameCount,
  gameEventPictures,
  gameEventText,
  gameOverlayRows,
  gameStepsText,
} from "./games";

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
        count: 0,
        column: 1,
      },
      {
        id: "zombie",
        pictures: [],
        event: "Follow",
        image: null,
        name: "Zombie",
        count: 0,
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

describe("gameStepsText", () => {
  const steps = (
    edition: GameAction["edition"],
    ...list: GameAction["steps"]
  ) =>
    gameStepsText(
      action((a) => {
        a.edition = edition;
        a.steps = list;
      }),
    );

  it("names what the steps make, as the action's edition names it", () => {
    expect(
      steps(
        "java",
        { type: "spawn", mob: "zombie", amount: 5, name: "" },
        { type: "give", item: "diamond", amount: 1 },
        { type: "weather", weather: "thunder" },
        { type: "time", time: "night" },
      ),
    ).toBe("Zombie ×5, Diamond, Thunder, Night");
    // Bedrock's id for Java's cobweb
    expect(steps("bedrock", { type: "give", item: "web", amount: 1 })).toBe(
      "Cobweb",
    );
  });

  it("names nothing for commands and ids the game doesn't have", () => {
    expect(
      steps(
        "java",
        { type: "command", command: "say hi" },
        { type: "spawn", mob: "constructor", amount: 1, name: "" },
        { type: "give", item: "web", amount: 1 },
      ),
    ).toBe("");
  });

  it("leaves out the count its picture shows: the first mob's or item's", () => {
    const zombies = action((a) => {
      a.steps = [
        { type: "weather", weather: "thunder" },
        { type: "spawn", mob: "zombie", amount: 5, name: "" },
        { type: "give", item: "diamond", amount: 3 },
      ];
    });

    expect(gameCount(zombies)).toBe(5);
    expect(gameStepsText(zombies, true)).toBe("Thunder, Zombie, Diamond ×3");
    expect(gameStepsText(zombies)).toBe("Thunder, Zombie ×5, Diamond ×3");
    expect(gameCount(action())).toBe(0);
  });

  it("counts a row on its picture, and in its name without one", () => {
    const zombies = (image: typeof picture | null) =>
      action((a) => {
        a.overlay.image = image;
        a.overlay.name = "";
        a.steps = [{ type: "spawn", mob: "zombie", amount: 5, name: "" }];
      });

    expect(rows(zombies(picture))[0]).toMatchObject({
      name: "Zombie",
      count: 5,
    });
    expect(rows(zombies(null))[0]).toMatchObject({
      name: "Zombie ×5",
      count: 0,
    });
  });

  it("names a row on the overlay until the streamer types one", () => {
    const zombie = action((a) => {
      a.overlay.name = "";
      a.steps = [{ type: "spawn", mob: "zombie", amount: 1, name: "" }];
    });

    expect(rows(zombie)[0].name).toBe("Zombie");
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
  it("shows every gift's picture once, skipping gifts without one", () => {
    const many = action(
      (a) => (a.trigger.gifts = [1, 5655, 6369, 5655, 6369]),
      TOKIO_EVENTS.GIFT,
    );

    expect(gameEventPictures(many, gifts, emotes)).toEqual([
      "Rose.png",
      "Lion.png",
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
