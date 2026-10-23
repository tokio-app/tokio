import { Alert, ALERT_TRIGGERS } from "@/common/schemas";
import {
  ALERT_TRIGGER_LABELS,
  AlertTrigger,
  EMOTE_TRIGGER,
  TOKIO_EVENTS,
} from "@/common/types";
import { createAlert } from "@/pages/Alerts/helper";
import { alertMedia, alertSound, gift, voice } from "@test/fixtures";
import { inList } from "@test/queries";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { AlertItem } from ".";

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
    gifts: GIFTS,
    emotes: EMOTES,
    testing: null,
    onTest: vi.fn(),
    onChange: vi.fn(),
    onRemove: vi.fn(),
    onPickSound: vi.fn(),
    onPickMedia: vi.fn(),
    ...props,
  };
  const view = render(<AlertItem {...all} />);
  const rerender = (patch: Partial<Props>) =>
    view.rerender(<AlertItem {...all} {...patch} />);
  return { ...view, ...all, rerender, user: userEvent.setup() };
}

const labeled = (...types: AlertTrigger[]) =>
  types.map((type) => ({ type, label: ALERT_TRIGGER_LABELS[type] }));

const FILTERS = ["Any gift", "Any emote", "Any message", "Anyone"];

const filters = () =>
  FILTERS.filter(
    (text) =>
      screen.queryByText(text) !== null ||
      screen.queryByPlaceholderText(text) !== null,
  );

describe("AlertItem", () => {
  it("can't play an alert with no sound, message or media", async () => {
    const { user, onTest } = setup(alert());

    const play = screen.getByRole("button", { name: "Play" });
    expect(play).toBeDisabled();

    await user.click(play);
    expect(onTest).not.toHaveBeenCalled();
  });

  it("plays its sound at its volume", async () => {
    const { user, onTest } = setup(alert({ sound: alertSound("Airhorn") }));

    await user.click(screen.getByRole("button", { name: "Play" }));

    expect(onTest).toHaveBeenCalledWith({
      id: "alert-1",
      file: "airhorn.mp3",
      volume: 80,
    });
  });

  it("speaks its message instead of the sound when it has both", async () => {
    const { user, onTest } = setup(
      alert(
        { sound: alertSound("Airhorn"), tts: TTS },
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
      alert({ sound: alertSound("Airhorn"), media }),
    );

    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(onTest).toHaveBeenLastCalledWith({
      id: "alert-1",
      file: "airhorn.mp3",
      volume: 80,
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
    const { rerender } = setup(alert({ sound: alertSound("Airhorn") }), {
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

  it("changes its volume", () => {
    const item = alert();
    const { onChange } = setup(item);
    const slider = screen.getByRole("slider", { name: "Volume" });
    expect(slider).toHaveValue("80");

    fireEvent.change(slider, { target: { value: "40" } });

    expect(onChange).toHaveBeenCalledWith({ ...item, volume: 40 });
  });

  it("lists every trigger, with Emote right after Chat", async () => {
    const { user, container } = setup(alert());

    await user.click(screen.getByRole("combobox", { name: "Trigger" }));

    const listed = ALERT_TRIGGERS.map((trigger) =>
      inList(container, ALERT_TRIGGER_LABELS[trigger]),
    );
    expect(listed).not.toContain(null);
    for (let i = 1; i < listed.length; i++) {
      expect(listed[i - 1]!.compareDocumentPosition(listed[i]!)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }
    expect(ALERT_TRIGGERS.indexOf(EMOTE_TRIGGER)).toBe(
      ALERT_TRIGGERS.indexOf(TOKIO_EVENTS.CHAT) + 1,
    );
  });

  it("changes its trigger and keeps the trigger's filters", async () => {
    const item = alert({}, { gifts: [5655], keyword: "hello" });
    const { user, container, onChange } = setup(item);

    await user.click(within(container).getByText("Follow"));
    await user.click(inList(container, "Gift")!);

    expect(onChange).toHaveBeenCalledWith({
      ...item,
      trigger: { ...item.trigger, type: TOKIO_EVENTS.GIFT },
    });
  });

  it("narrows a gift alert to the gifts picked", async () => {
    const item = alert({}, { type: TOKIO_EVENTS.GIFT });
    const { user, onChange } = setup(item);
    expect(filters()).toEqual(["Any gift"]);

    await user.click(screen.getByRole("button", { name: "Any gift" }));
    const picker = within(screen.getByRole("dialog"));
    await user.click(picker.getByTitle("GG"));
    await user.click(picker.getByRole("button", { name: "Done" }));

    expect(onChange).toHaveBeenCalledWith({
      ...item,
      trigger: { ...item.trigger, gifts: [6064] },
    });
  });

  it("shows the gifts a gift alert is narrowed to", () => {
    const { container } = setup(
      alert({}, { type: TOKIO_EVENTS.GIFT, gifts: [5655] }),
    );

    expect(within(container).getByText("Rose")).toBeInTheDocument();
    expect(within(container).queryByText("GG")).not.toBeInTheDocument();
  });

  it("narrows an emote alert to the emotes picked", async () => {
    const item = alert({}, { type: EMOTE_TRIGGER, emotes: ["emote-1"] });
    const { user, container, onChange } = setup(item);
    expect(within(container).getByText("Emote 1")).toBeInTheDocument();

    await user.click(within(container).getByText("Emote 1"));
    await user.click(inList(container, "Emote 2")!);

    expect(onChange).toHaveBeenCalledWith({
      ...item,
      trigger: { ...item.trigger, emotes: ["emote-1", "emote-2"] },
    });
  });

  it("says an emote alert without emotes plays for any", () => {
    setup(alert({}, { type: EMOTE_TRIGGER }));

    expect(filters()).toEqual(["Any emote"]);
  });

  it("narrows a chat alert to a keyword", async () => {
    const item = alert({}, { type: TOKIO_EVENTS.CHAT, keyword: "hell" });
    const { user, onChange } = setup(item);
    expect(filters()).toEqual(["Any message"]);
    const keyword = screen.getByPlaceholderText("Any message");
    expect(keyword).toHaveValue("hell");

    await user.type(keyword, "o");

    expect(onChange).toHaveBeenCalledWith({
      ...item,
      trigger: { ...item.trigger, keyword: "hello" },
    });
  });

  it.each(labeled(TOKIO_EVENTS.MEMBER_JOIN, TOKIO_EVENTS.SUPER_FAN_JOIN))(
    "narrows a $label alert to a viewer",
    async ({ type }) => {
      const item = alert({}, { type });
      const { user, onChange } = setup(item);
      expect(filters()).toEqual(["Anyone"]);

      await user.type(screen.getByPlaceholderText("Anyone"), "@");

      expect(onChange).toHaveBeenCalledWith({
        ...item,
        trigger: { ...item.trigger, user: "@" },
      });
    },
  );

  it.each(
    labeled(
      TOKIO_EVENTS.FOLLOW,
      TOKIO_EVENTS.LIKE,
      TOKIO_EVENTS.SHARE,
      TOKIO_EVENTS.MUSIC_CHANGE,
    ),
  )("has nothing to narrow a $label alert to", ({ type }) => {
    setup(alert({}, { type }));

    expect(filters()).toEqual([]);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("names its sound, or asks for one", async () => {
    const { user, onPickSound, unmount } = setup(alert());

    await user.click(screen.getByRole("button", { name: "Select a sound..." }));
    expect(onPickSound).toHaveBeenCalledOnce();
    unmount();

    setup(alert({ sound: alertSound("Airhorn") }));
    expect(screen.getByRole("button", { name: "Airhorn" })).toHaveAttribute(
      "title",
      "Airhorn",
    );
  });

  it("names its media, or asks for some", async () => {
    const { user, onPickMedia, unmount } = setup(alert());

    await user.click(screen.getByRole("button", { name: "Select media..." }));
    expect(onPickMedia).toHaveBeenCalledOnce();
    unmount();

    setup(alert({ media: alertMedia("Party") }));
    expect(screen.getByRole("button", { name: "Party" })).toHaveAttribute(
      "title",
      "Party",
    );
  });

  it("names its message when it speaks one", async () => {
    const { user, onPickSound } = setup(
      alert({ sound: alertSound("Airhorn"), tts: TTS }),
    );

    const button = screen.getByRole("button", {
      name: "TTS: Thanks {username}!",
    });
    expect(screen.queryByText("Airhorn")).not.toBeInTheDocument();

    await user.click(button);
    expect(onPickSound).toHaveBeenCalledOnce();
  });
});
