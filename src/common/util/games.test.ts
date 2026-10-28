import { describe, expect, it } from "vitest";
import { EVENT_SPRITES } from "../games/sprites";
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
  gameEventCount,
  gameEventPictures,
  gameEventText,
  gameOverlayRows,
  gameStepsText,
  giftNames,
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

describe("giftNames", () => {
  it("names the gifts the lists have, at most as many as asked", () => {
    expect(giftNames([5655, 6369, 1], gifts, "en", 2)).toBe("Rose or 2 more");
    expect(giftNames([5655, 6369, 1], gifts, "en")).toBe("Rose, Lion, or Bare");
    expect(giftNames([5655, 6369], gifts, "es-419")).toBe("Rose o Lion");
    expect(giftNames([42], gifts, "en")).toBeNull();
  });
});

const games = (actions: GameAction[], columns = 1): Profile["games"] => ({
  actions,
  overlay: GamesOverlaySchema.parse({ columns }),
});

const sources = {
  gifts,
  emotes,
  mediaURL: (file: string) => `/games/minecraft/pictures/${file}`,
  language: "en",
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
        withText: false,
        eventCount: 0,
        image: "/games/minecraft/pictures/abc.png",
        name: "TNT",
        count: 0,
        column: 1,
      },
      {
        id: "zombie",
        pictures: [EVENT_SPRITES[TOKIO_EVENTS.FOLLOW]],
        event: "Follow",
        withText: false,
        eventCount: 0,
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

  it("shows a chat's message by its bubble, and the likes on the heart", () => {
    const chat = action((a) => (a.trigger.keyword = "tnt"), TOKIO_EVENTS.CHAT);
    const likes = action((a) => (a.likes_every = 100), TOKIO_EVENTS.LIKE);

    expect(rows(chat)[0]).toMatchObject({
      pictures: [EVENT_SPRITES[TOKIO_EVENTS.CHAT]],
      event: "“tnt”",
      withText: true,
      eventCount: 0,
    });
    expect(rows(likes)[0]).toMatchObject({
      pictures: [EVENT_SPRITES[TOKIO_EVENTS.LIKE]],
      event: "100 likes",
      withText: false,
      eventCount: 100,
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
      "en",
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

  it("names hazards, counted only when they repeat", () => {
    const hazard = {
      type: "hazard",
      fuse: 4,
      height: 50,
      seconds: 1,
      duration: 10,
      distance: 1000,
    } as const;
    expect(
      steps(
        "bedrock",
        { ...hazard, hazard: "lightning", amount: 5 },
        { ...hazard, hazard: "tnt", amount: 3 },
        { ...hazard, hazard: "launch_water", amount: 1 },
      ),
    ).toBe("Lightning bolt ×5, Falling TNT, Launch + water");
  });

  it("names helps", () => {
    expect(
      steps(
        "java",
        { type: "help", help: "netherite_armor", duration: 30 },
        { type: "help", help: "heal", duration: 30 },
      ),
    ).toBe("Netherite armor, Full heal");
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
    expect(gameStepsText(zombies, "en", true)).toBe(
      "Thunder, Zombie, Diamond ×3",
    );
    expect(gameStepsText(zombies, "en")).toBe("Thunder, Zombie ×5, Diamond ×3");
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

  it("names Tokio's own steps in the language, and mobs and items in English", () => {
    const night = action((a) => {
      a.steps = [
        { type: "spawn", mob: "zombie", amount: 2, name: "" },
        { type: "time", time: "night" },
        { type: "help", help: "heal", duration: 30 },
      ];
    });

    expect(gameStepsText(night, "es-419")).toBe(
      "Zombie ×2, Noche, Curación completa",
    );
  });
});

describe("gameEventText", () => {
  const text = (a: GameAction, language = "en") =>
    gameEventText(a, gifts, language);

  it("names the gifts, or any gift when none are picked", () => {
    const giftAction = (ids: number[]) =>
      action((a) => (a.trigger.gifts = ids), TOKIO_EVENTS.GIFT);

    expect(text(giftAction([5655, 6369]))).toBe("Rose or Lion");
    expect(text(giftAction([5655, 6369, 1]))).toBe("Rose, Lion, or Bare");
    expect(text(giftAction([]))).toBe("Any gift");
    // Until the gift lists load
    expect(text(giftAction([42]))).toBe("Gift");
    expect(text(giftAction([]), "es-419")).toBe("Cualquier regalo");
    expect(text(giftAction([42]), "es-419")).toBe("Regalo");
  });

  it("counts the likes", () => {
    const likes = (n: number) =>
      action((a) => (a.likes_every = n), TOKIO_EVENTS.LIKE);

    expect(text(likes(100))).toBe("100 likes");
    expect(text(likes(1))).toBe("1 like");
    expect(text(likes(1000), "es-419")).toBe("1,000 Me gusta");
  });

  it("quotes chat's keyword, as the timer's carousel does", () => {
    const chat = (keyword: string) =>
      action((a) => (a.trigger.keyword = keyword), TOKIO_EVENTS.CHAT);

    // Its bubble says chat
    expect(text(chat(" tnt "))).toBe("“tnt”");
    expect(text(chat(""))).toBe("");
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

  it("shows the emotes' pictures, and none with no gift or emote picked", () => {
    const emote = action(
      (a) => (a.trigger.emotes = ["e1", "gone"]),
      EMOTE_TRIGGER,
    );

    expect(gameEventPictures(emote, gifts, emotes)).toEqual(["e1.png"]);
    for (const type of [TOKIO_EVENTS.GIFT, EMOTE_TRIGGER] as const) {
      expect(
        gameEventPictures(
          action(() => {}, type),
          gifts,
          emotes,
        ),
      ).toEqual([]);
    }
  });

  it("draws Tokio's own for follows, shares, likes, chat and Super Fans", () => {
    const events: GameAction["trigger"]["type"][] = [
      TOKIO_EVENTS.FOLLOW,
      TOKIO_EVENTS.SHARE,
      TOKIO_EVENTS.LIKE,
      TOKIO_EVENTS.CHAT,
      TOKIO_EVENTS.SUPER_FAN,
    ];
    const pictures = events.map((type) =>
      gameEventPictures(
        action(() => {}, type),
        gifts,
        emotes,
      ),
    );

    expect(new Set(pictures.flat()).size).toBe(5);
    for (const [src] of pictures) {
      expect(src).toMatch(/^data:image\/svg\+xml,/);
    }
    // A rectangle per run of pixels of one color, on a 13×13 grid
    const heart = decodeURIComponent(EVENT_SPRITES[TOKIO_EVENTS.LIKE]!);
    expect(heart).toContain('viewBox="0 0 13 13"');
    expect(heart).toMatch(/<path fill="#000000" d="M2 1h3v1H2zM8 1h3v1H8z/);
  });
});

describe("gameEventCount", () => {
  it("counts a Like action's likes, none for one or other events", () => {
    const likes = (n: number) =>
      action((a) => (a.likes_every = n), TOKIO_EVENTS.LIKE);

    expect(gameEventCount(likes(100))).toBe(100);
    expect(gameEventCount(likes(1))).toBe(0);
    expect(gameEventCount(action((a) => (a.likes_every = 100)))).toBe(0);
  });
});
