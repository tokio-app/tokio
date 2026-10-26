import { Alert } from "@/common/schemas";
import { EMOTE_TRIGGER, TOKIO_EVENTS } from "@/common/types";
import { createAlert } from "@/pages/Alerts/helper";
import { alertClip, alertMedia, gift, voice } from "@test/fixtures";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { AlertItem, TriggerFilter, triggerSummary } from ".";

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
    expect(
      screen.getByText("Rose or GG, when the streak ends, from Moderators"),
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
    // The cut's part, without reading the file
    expect(summary()).toHaveTextContent("5s");
    expect(cut.container.querySelector("audio")).toBeNull();
    expect(summary()).toHaveTextContent("Party");
    expect(summary()).toHaveTextContent("9s");
    cut.unmount();

    // To the end, from the file's length
    const { container } = setup(
      alert({ sound: alertClip("Airhorn", { start: 3 }) }),
    );
    const audio = container.querySelector("audio")!;
    expect(audio.getAttribute("src")).toBe("tokio-media:///sounds/airhorn.mp3");
    Object.defineProperty(audio, "duration", { value: 10 });
    fireEvent.loadedMetadata(audio);
    expect(summary()).toHaveTextContent("7s");
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
    triggerSummary(alert({}, trigger).trigger, GIFTS, EMOTES);

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
      triggerSummary(alert({}, trigger).trigger, gifts, emotes);

    expect(of({ type: TOKIO_EVENTS.GIFT, gifts: [5655, 6064, 1, 2] })).toBe(
      "Rose, GG or 2 more, when the streak ends",
    );
    expect(
      of({ type: EMOTE_TRIGGER, emotes: ["emote-1", "emote-2", "x", "x"] }),
    ).toBe("Emote 1, Emote 2 or 2 more");
  });

  it("counts on gifts the lists don't have yet", () => {
    expect(sum({ type: TOKIO_EVENTS.GIFT, gifts: [1] })).toBe(
      "Some gifts, when the streak ends",
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
