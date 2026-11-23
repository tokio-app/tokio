import { Alert } from "@/common/schemas";
import { EMOTE_TRIGGER, Platform, TOKIO_EVENTS } from "@/common/types";
import { PlatformsContext } from "@/context/platforms";
import { createAlert } from "@/common/util";
import { intersect } from "@test/dom";
import { alertClip, alertMedia, gift, voice } from "@test/fixtures";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { Params, translate } from "@/common/i18n";
import {
  AlertItem,
  minUnit,
  TriggerFilter,
  triggerLabel,
  triggerSummary,
} from ".";

const GIFTS = [gift(5655, "Rose"), gift(6064, "GG")];
const EMOTES = [
  { value: "emote-1", label: "Emote 1", img: "emote-1.png" },
  { value: "emote-2", label: "Emote 2", img: "emote-2.png" },
];

const TTS = {
  voice: voice("Aria"),
  message: "Thanks {username}!",
  speed: 1.2,
  pitch: 0.9,
};

function alert(
  patch: Partial<Alert> = {},
  trigger: Partial<Alert["trigger"]> = {},
): Alert {
  const base = createAlert();
  return {
    ...base,
    id: "alert-1",
    volume: 80,
    ...patch,
    trigger: { ...base.trigger, ...trigger },
  };
}

type Props = ComponentProps<typeof AlertItem>;

function setup(item: Alert, props: Partial<Props> = {}) {
  const all: Props = {
    alert: item,
    index: 0,
    gifts: GIFTS,
    emotes: EMOTES,
    testing: null,
    onTest: vi.fn(),
    onChange: vi.fn(),
    onEdit: vi.fn(),
    onRemove: vi.fn(),
    ...props,
  };
  const view = render(<AlertItem {...all} />);
  const rerender = (patch: Partial<Props>) =>
    view.rerender(<AlertItem {...all} {...patch} />);
  return { ...view, ...all, rerender, user: userEvent.setup() };
}

const summary = () => screen.getByTitle("Edit alert");

describe("AlertItem", () => {
  it("can't play an alert with no sound, message or media", async () => {
    const { user, onTest } = setup(alert());

    const play = screen.getByRole("button", { name: "Play" });
    expect(play).toBeDisabled();

    await user.click(play);
    expect(onTest).not.toHaveBeenCalled();
  });

  it("plays its sound at its volume, the part its cut keeps", async () => {
    const { user, onTest, unmount } = setup(
      alert({ sound: alertClip("Airhorn") }),
    );

    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(onTest).toHaveBeenCalledWith({
      id: "alert-1",
      file: "airhorn.mp3",
      volume: 80,
      start: 0,
    });
    unmount();

    const cut = setup(
      alert({ sound: alertClip("Airhorn", { start: 0.5, end: 1.5 }) }),
    );
    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(cut.onTest).toHaveBeenCalledWith({
      id: "alert-1",
      file: "airhorn.mp3",
      volume: 80,
      start: 0.5,
      end: 1.5,
    });
  });

  it("speaks its message instead of the sound when it has both", async () => {
    const { user, onTest } = setup(
      alert(
        { sound: alertClip("Airhorn"), tts: TTS },
        { type: TOKIO_EVENTS.GIFT },
      ),
    );

    await user.click(screen.getByRole("button", { name: "Play" }));

    expect(onTest).toHaveBeenCalledWith({
      id: "alert-1",
      tts: TTS,
      trigger: TOKIO_EVENTS.GIFT,
      volume: 80,
    });
  });

  it("shows its media with its sound, or alone", async () => {
    const media = alertMedia("Party");
    const { user, onTest, unmount } = setup(
      alert({ sound: alertClip("Airhorn"), media }),
    );

    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(onTest).toHaveBeenLastCalledWith({
      id: "alert-1",
      file: "airhorn.mp3",
      volume: 80,
      start: 0,
      media,
    });
    unmount();

    const alone = setup(alert({ media }));
    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(alone.onTest).toHaveBeenCalledWith({
      id: "alert-1",
      volume: 80,
      media,
    });
  });

  it("shows whether its own test is loading or playing", () => {
    const { rerender } = setup(alert({ sound: alertClip("Airhorn") }), {
      testing: { id: "alert-2", loading: false },
    });
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();

    rerender({ testing: { id: "alert-1", loading: true } });
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();

    rerender({ testing: { id: "alert-1", loading: false } });
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
  });

  it("removes itself", async () => {
    const { user, onRemove } = setup(alert());

    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("turns itself off and on", async () => {
    const item = alert();
    const { user, onChange } = setup(item);
    const toggle = screen.getByRole("checkbox", { name: "Enabled" });
    expect(toggle).toBeChecked();

    await user.click(toggle);

    expect(onChange).toHaveBeenCalledWith({ ...item, enabled: false });
  });

  it("opens its editor from its summary", async () => {
    const { user, onEdit } = setup(alert());

    await user.click(summary());

    expect(onEdit).toHaveBeenCalledOnce();
  });

  it("sums up what sets it off", () => {
    setup(
      alert(
        {},
        {
          type: TOKIO_EVENTS.GIFT,
          gifts: [5655, 6064],
          roles: ["moderator"],
        },
      ),
    );

    expect(summary()).toHaveTextContent("Gift");
    expect(screen.getByRole("img", { name: "Rose or GG" })).toBeInTheDocument();
    expect(
      screen.getByText("When the streak ends, from Moderators"),
    ).toBeInTheDocument();
  });

  it("names every event an alert has, once, and what each narrows", () => {
    const base = alert({}, { type: TOKIO_EVENTS.GIFT, gifts: [] });
    setup({
      ...base,
      also_triggers: [
        { ...base.trigger, type: TOKIO_EVENTS.CHAT, keyword: "hi" },
        { ...base.trigger, type: TOKIO_EVENTS.GIFT, gifts: [5655] },
        { ...base.trigger, type: TOKIO_EVENTS.FOLLOW },
      ],
    });

    expect(summary()).toHaveTextContent("Gift, Chat, or Follow");
    // The follow row narrows nothing, so it says nothing
    expect(
      screen.getByText(
        "Any gift, when the streak ends · Messages with “hi” · When the streak ends",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Rose" })).toBeInTheDocument();
  });

  it("pictures the gifts of every row, three at most", () => {
    const base = alert({}, { type: TOKIO_EVENTS.GIFT, gifts: [5655, 6064] });
    setup(
      {
        ...base,
        also_triggers: [
          { ...base.trigger, gifts: [1, 2] },
          { ...base.trigger, type: EMOTE_TRIGGER, emotes: ["emote-1"] },
        ],
      },
      { gifts: [...GIFTS, gift(1, "Lion"), gift(2, "Galaxy")] },
    );

    const pictures = screen.getByRole("img", {
      name: "Rose or GG · Lion or Galaxy · Emote 1",
    });
    expect(pictures.querySelectorAll("img")).toHaveLength(3);
    expect(pictures).toHaveTextContent("+2");
  });

  it("shows three gifts' or emotes' pictures at most, and names them without any", () => {
    const gifts = [
      ...GIFTS,
      gift(1, "Lion"),
      { ...gift(2, "Galaxy"), img: "" },
    ];
    const many = setup(
      alert({}, { type: TOKIO_EVENTS.GIFT, gifts: [5655, 6064, 1, 2] }),
      { gifts },
    );
    const pictures = screen.getByRole("img", { name: "Rose, GG, or 2 more" });
    expect(pictures.querySelectorAll("img")).toHaveLength(3);
    expect(pictures).toHaveTextContent("+1");
    many.unmount();

    const emote = setup(
      alert({}, { type: EMOTE_TRIGGER, emotes: ["emote-2"] }),
    );
    expect(screen.getByRole("img", { name: "Emote 2" })).toBeInTheDocument();
    emote.unmount();

    setup(alert({}, { type: TOKIO_EVENTS.GIFT, gifts: [2] }), { gifts });
    expect(screen.queryByRole("img")).toBeNull();
    expect(
      screen.getByText("Galaxy, when the streak ends"),
    ).toBeInTheDocument();
  });

  it("names its sound and how long it plays, or says it has none", () => {
    const { unmount } = setup(alert());
    expect(summary()).toHaveTextContent("No sound");
    expect(summary()).toHaveTextContent("No media");
    unmount();

    const cut = setup(
      alert({
        sound: alertClip("Airhorn", { start: 3, end: 8 }),
        media: alertMedia("Party", { duration: 9 }),
      }),
    );
    expect(summary()).toHaveTextContent("Airhorn");
    // The cut's part of the file's length, as the queue plays it
    intersect();
    const length = cut.container.querySelector("audio")!;
    Object.defineProperty(length, "duration", { value: 10 });
    fireEvent.loadedMetadata(length);
    expect(summary()).toHaveTextContent("5s");
    expect(summary()).toHaveTextContent("Party");
    expect(summary()).toHaveTextContent("9s");
    cut.unmount();

    // To the end, from the file's length
    const { container } = setup(
      alert({ sound: alertClip("Airhorn", { start: 3 }) }),
    );
    intersect();
    const audio = container.querySelector("audio")!;
    expect(audio.getAttribute("src")).toBe("tokio-media:///sounds/airhorn.mp3");
    Object.defineProperty(audio, "duration", { value: 10 });
    fireEvent.loadedMetadata(audio);
    expect(summary()).toHaveTextContent("7s");
  });

  it("reads a new sound's length again", () => {
    const { container, rerender } = setup(
      alert({ sound: alertClip("Airhorn") }),
    );
    const load = (seconds: number) => {
      intersect();
      const audio = container.querySelector("audio")!;
      Object.defineProperty(audio, "duration", { value: seconds });
      fireEvent.loadedMetadata(audio);
    };
    load(10);
    expect(summary()).toHaveTextContent("10s");

    rerender({ alert: alert({ sound: alertClip("Siren") }) });
    expect(summary()).toHaveTextContent("Siren");
    expect(summary()).not.toHaveTextContent("10s");
    load(4);
    expect(summary()).toHaveTextContent("4s");
  });

  it("shows its name, or the one its place gives it while it has none", () => {
    const { unmount } = setup(alert({ name: "Big gifts" }));
    expect(summary()).toHaveTextContent("Big gifts");
    unmount();

    setup(alert({ name: "  " }), { index: 2 });
    expect(summary()).toHaveTextContent("alert-3");
  });

  it("copies its overlay URL, only when it shows media", async () => {
    const { user, unmount } = setup(alert({ media: alertMedia("Party") }));

    await user.click(screen.getByRole("button", { name: "Copy overlay URL" }));
    expect(await navigator.clipboard.readText()).toBe(
      "http://tokio-app.local:37891/alerts/alert-1/",
    );
    unmount();

    setup(alert());
    expect(
      screen.queryByRole("button", { name: "Copy overlay URL" }),
    ).toBeNull();
  });

  it("names its message when it speaks one", () => {
    setup(alert({ sound: alertClip("Airhorn"), tts: TTS }));

    expect(summary()).toHaveTextContent("“Thanks {username}!”");
    expect(summary()).not.toHaveTextContent("Airhorn");
  });
});

describe("triggerSummary", () => {
  const sum = (trigger: Partial<Alert["trigger"]>) =>
    triggerSummary([alert({}, trigger).trigger], GIFTS, EMOTES, "en");

  it("counts the coins only for any gift", () => {
    expect(sum({ type: TOKIO_EVENTS.GIFT, min_coins: 100 })).toBe(
      "Any gift, when the streak ends, worth 100+ coins",
    );
    expect(
      sum({ type: TOKIO_EVENTS.GIFT, gifts: [5655], min_coins: 100 }),
    ).toBe("Rose, when the streak ends");
  });

  it("says what each filter narrows the trigger to", () => {
    expect(sum({ type: TOKIO_EVENTS.GIFT, every_gift: true })).toBe(
      "Any gift, every gift",
    );
    expect(sum({ type: EMOTE_TRIGGER })).toBe("Any emote");
    expect(sum({ type: EMOTE_TRIGGER, emotes: ["emote-2"] })).toBe("Emote 2");
    expect(sum({ type: TOKIO_EVENTS.CHAT, keyword: " hi " })).toBe(
      "Messages with “hi”",
    );
    expect(sum({ type: TOKIO_EVENTS.MEMBER_JOIN, user: "@viewer" })).toBe(
      "Only @viewer",
    );
    expect(sum({ type: TOKIO_EVENTS.FOLLOW })).toBe("");
  });

  it("names the roles only for events with the viewer's roles", () => {
    const roles: Alert["trigger"]["roles"] = ["follower", "superfan"];

    expect(sum({ type: TOKIO_EVENTS.CHAT, roles })).toBe(
      "Any message, from Followers or Super Fans",
    );
    expect(sum({ type: TOKIO_EVENTS.SHARE, roles })).toBe("");
    expect(sum({ type: TOKIO_EVENTS.FOLLOW, roles })).toBe("");
    expect(sum({ type: TOKIO_EVENTS.ENVELOPE, roles })).toBe("");
  });

  it("names three gifts or emotes at most, then counts the rest", () => {
    const gifts = [...GIFTS, gift(1, "Lion"), gift(2, "Galaxy")];
    const emotes = [...EMOTES, ...EMOTES.map((e) => ({ ...e, value: "x" }))];
    const of = (trigger: Partial<Alert["trigger"]>) =>
      triggerSummary([alert({}, trigger).trigger], gifts, emotes, "en");

    expect(of({ type: TOKIO_EVENTS.GIFT, gifts: [5655, 6064, 1, 2] })).toBe(
      "Rose, GG, or 2 more, when the streak ends",
    );
    expect(
      of({ type: EMOTE_TRIGGER, emotes: ["emote-1", "emote-2", "x", "x"] }),
    ).toBe("Emote 1, Emote 2, or 2 more");
  });

  it("counts on gifts the lists don't have yet", () => {
    expect(sum({ type: TOKIO_EVENTS.GIFT, gifts: [1] })).toBe(
      "Some gifts, when the streak ends",
    );
  });
});

describe("triggerSummary with several triggers", () => {
  const rows = [
    alert({}, { type: TOKIO_EVENTS.GIFT, min_coins: 100 }).trigger,
    alert({}, { type: TOKIO_EVENTS.CHAT, keyword: "hi" }).trigger,
    alert({}, { type: TOKIO_EVENTS.FOLLOW }).trigger,
  ];

  it("gives each trigger's conditions a clause, and skips empty ones", () => {
    expect(triggerSummary(rows, GIFTS, EMOTES, "en")).toBe(
      "Any gift, when the streak ends, worth 100+ coins · Messages with “hi”",
    );
    expect(triggerSummary(rows.slice(2), GIFTS, EMOTES, "en")).toBe("");
  });

  it("leaves out a row's gifts only when its pictures show", () => {
    const picked = { ...rows[0], gifts: [5655, 2], min_coins: 0 };
    const gifts = [...GIFTS, gift(2, "Galaxy")];

    expect(triggerSummary([picked, rows[1]], gifts, EMOTES, "en", true)).toBe(
      "When the streak ends · Messages with “hi”",
    );
    // Neither has a picture, so the sentence names them
    const bare = gifts.map((g) => ({ ...g, img: "" }));
    expect(triggerSummary([picked], bare, EMOTES, "en", true)).toBe(
      "Rose or Galaxy, when the streak ends",
    );
  });
});

describe("TriggerFilter", () => {
  it("has nothing for a trigger without a filter", () => {
    const { container } = render(
      <TriggerFilter
        trigger={alert().trigger}
        gifts={GIFTS}
        emotes={EMOTES}
        onChange={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe("Redeem and platforms", () => {
  const t = (key: Parameters<typeof translate>[1], params?: Params) =>
    translate("en", key, params);

  it("narrows a Redeem row to the reward's title", () => {
    const sum = (keyword: string) =>
      triggerSummary(
        [alert({}, { type: TOKIO_EVENTS.REDEEM, keyword }).trigger],
        GIFTS,
        EMOTES,
        "en",
      );

    expect(sum("")).toBe("Any reward");
    expect(sum(" Hydrate ")).toBe("Reward “Hydrate”");
  });

  it("types the reward in the filter", async () => {
    const onChange = vi.fn();
    render(
      <TriggerFilter
        trigger={alert({}, { type: TOKIO_EVENTS.REDEEM }).trigger}
        gifts={GIFTS}
        emotes={EMOTES}
        onChange={onChange}
      />,
    );

    await userEvent.type(screen.getByPlaceholderText("Any reward"), "H");

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ keyword: "H" }),
    );
  });

  it("names a row's platform", () => {
    const base = alert({}, { type: TOKIO_EVENTS.FOLLOW, platform: "twitch" });
    const withGift = {
      ...base,
      also_triggers: [alert({}, { type: TOKIO_EVENTS.GIFT }).trigger],
    };

    expect(triggerLabel(withGift, t, "en")).toBe("Follow on Twitch or Gift");
  });

  it("names a Kick row's gifts Kicks, any platform's still Gift", () => {
    const kicks = alert({}, { type: TOKIO_EVENTS.GIFT, platform: "kick" });
    const any = alert({}, { type: TOKIO_EVENTS.GIFT });

    expect(triggerLabel(kicks, t, "en")).toBe("Kicks on Kick");
    expect(triggerLabel(any, t, "en")).toBe("Gift");
  });
});

describe("money rows' minimums", () => {
  const sum = (type: Alert["trigger"]["type"], min_coins: number) =>
    triggerSummary([alert({}, { type, min_coins }).trigger], [], [], "en");

  it("takes each event's own unit, and none for events without money", () => {
    const unit = (type: Alert["trigger"]["type"]) =>
      minUnit(alert({}, { type }).trigger, ["twitch", "youtube"]);

    expect(unit(TOKIO_EVENTS.CHEER)).toBe("bits");
    expect(unit(TOKIO_EVENTS.SUPER_CHAT)).toBe("usd");
    expect(unit(TOKIO_EVENTS.GIFT_SUB)).toBe("subs");
    expect(unit(TOKIO_EVENTS.FOLLOW)).toBeNull();
  });

  it("sums up each minimum in its unit, and nothing at 0", () => {
    expect(sum(TOKIO_EVENTS.CHEER, 100)).toBe("Worth 100+ Bits");
    expect(sum(TOKIO_EVENTS.SUPER_CHAT, 5)).toBe("Worth $5+");
    expect(sum(TOKIO_EVENTS.GIFT_SUB, 5)).toBe("5+ gifted subs");
    expect(sum(TOKIO_EVENTS.CHEER, 0)).toBe("");
  });
});

describe("gift rows on each platform", () => {
  const row = (patch: Partial<Alert["trigger"]> = {}) =>
    alert({}, { type: TOKIO_EVENTS.GIFT, ...patch }).trigger;

  it("takes the minimum in the row's currency", () => {
    expect(minUnit(row(), ["tiktok"])).toBe("coins");
    expect(minUnit(row(), ["kick", "youtube"])).toBe("kicks");
    expect(minUnit(row(), ["tiktok", "kick"])).toBe("either");
    // A row for one platform, whatever the profile has
    expect(minUnit(row({ platform: "tiktok" }), ["tiktok", "kick"])).toBe(
      "coins",
    );
    expect(minUnit(row({ platform: "youtube" }), ["tiktok"])).toBeNull();
    // A minimum saved where gifts have no price stays to fix
    expect(minUnit(row({ platform: "youtube", min_coins: 5 }), [])).toBe(
      "coins",
    );
  });

  it("sums up the minimum in it", () => {
    const sum = (patch: Partial<Alert["trigger"]>, platforms: Platform[]) =>
      triggerSummary(
        [row({ min_coins: 100, ...patch })],
        GIFTS,
        EMOTES,
        "en",
        false,
        platforms,
      );

    expect(sum({}, ["tiktok", "kick"])).toBe(
      "Any gift, when the streak ends, worth 100+ coins or Kicks",
    );
    // A Kick row's gifts are Kicks, which come one at a time
    expect(sum({ platform: "kick" }, ["tiktok", "kick"])).toBe(
      "Any Kick, worth 100+ Kicks",
    );
  });

  it("offers TikTok's gifts only on rows they can set off, or with some picked", () => {
    // Its text: the placeholder, or the gifts picked
    const picker = (
      trigger: Alert["trigger"],
      platforms: Platform[],
      text = "Any gift",
    ) => {
      const { unmount } = render(
        <PlatformsContext value={platforms}>
          <TriggerFilter
            trigger={trigger}
            gifts={GIFTS}
            emotes={EMOTES}
            onChange={vi.fn()}
          />
        </PlatformsContext>,
      );
      const shown = screen.queryByText(text) !== null;
      unmount();
      return shown;
    };

    expect(picker(row(), ["tiktok", "kick"])).toBe(true);
    expect(picker(row(), ["kick", "youtube"])).toBe(false);
    expect(picker(row({ platform: "tiktok" }), ["kick"])).toBe(true);
    expect(picker(row({ platform: "kick" }), ["tiktok", "kick"])).toBe(false);
    expect(
      picker(row({ platform: "kick", gifts: [5655] }), ["kick"], "Rose"),
    ).toBe(true);
  });
});

describe("rows on their platforms", () => {
  const ALL: Platform[] = ["tiktok", "twitch", "youtube", "kick"];
  const SAVED = [
    { value: "7001", label: "Heart", img: "a.png" },
    { value: "twitch:25", label: "Kappa", img: "b.png" },
    { value: "kick:9", label: "KEKW", img: "c.png" },
    { value: "youtube:wave", label: "Wave", img: "d.png" },
  ];
  const NAMES = SAVED.map((emote) => emote.label);
  const filter = (trigger: Alert["trigger"], platforms: Platform[]) =>
    render(
      <PlatformsContext value={platforms}>
        <TriggerFilter
          trigger={trigger}
          gifts={GIFTS}
          emotes={SAVED}
          onChange={vi.fn()}
        />
      </PlatformsContext>,
    );
  const emoteRow = (patch: Partial<Alert["trigger"]> = {}) =>
    alert({}, { type: EMOTE_TRIGGER, ...patch }).trigger;
  // The emote picker's rows, by name
  const pickable = async (trigger: Alert["trigger"], platforms: Platform[]) => {
    const user = userEvent.setup();
    const view = filter(trigger, platforms);
    await user.click(within(view.container).getByRole("button"));
    const names = within(screen.getByRole("dialog"))
      .queryAllByTitle(/./)
      .map((el) => el.title)
      .filter((title) => NAMES.includes(title));
    view.unmount();
    return names;
  };

  it("offers a row only its platforms' emotes, and keeps picked ones", async () => {
    expect(await pickable(emoteRow({ platform: "twitch" }), ALL)).toEqual([
      "Kappa",
    ]);
    // Picked on another platform, to clear; the picker lists picks first
    expect(
      await pickable(emoteRow({ platform: "twitch", emotes: ["kick:9"] }), ALL),
    ).toEqual(["KEKW", "Kappa"]);
    // Any platform: the profile's
    expect(await pickable(emoteRow(), ["tiktok", "kick"])).toEqual([
      "Heart",
      "KEKW",
    ]);
  });

  it("has no streak choice where gifts come one at a time", () => {
    const giftRow = (patch: Partial<Alert["trigger"]> = {}) =>
      alert({}, { type: TOKIO_EVENTS.GIFT, ...patch }).trigger;
    const plays = (trigger: Alert["trigger"], platforms: Platform[]) => {
      const view = filter(trigger, platforms);
      const shown =
        screen.queryByRole("combobox", { name: "When it plays" }) !== null;
      view.unmount();
      return shown;
    };

    expect(plays(giftRow({ platform: "tiktok" }), ALL)).toBe(true);
    expect(plays(giftRow(), ["tiktok", "kick"])).toBe(true);
    // Kick's and YouTube's gifts come one at a time
    expect(plays(giftRow({ platform: "kick" }), ALL)).toBe(false);
    expect(plays(giftRow(), ["youtube", "kick"])).toBe(false);
    // With nothing to pick, nothing at all
    const view = filter(giftRow({ platform: "youtube" }), ALL);
    expect(view.container).toBeEmptyDOMElement();
  });
});
