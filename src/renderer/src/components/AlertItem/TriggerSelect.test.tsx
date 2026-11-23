import { GOAL_TRIGGER, Trigger, TriggerSchema } from "@/common/schemas";
import { Platform, TOKIO_EVENTS } from "@/common/types";
import { PlatformsContext } from "@/context/platforms";
import { useOptions } from "@/ui/i18n";
import { renderWithProviders } from "@test/render";
import { screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { TRIGGER_OPTIONS } from ".";
import { eventsFor, TriggerSelect, withPlatform } from "./TriggerSelect";

const trigger = (patch: Partial<Trigger> = {}): Trigger => ({
  ...TriggerSchema.parse({ type: TOKIO_EVENTS.FOLLOW, gifts: [] }),
  ...patch,
});

function Row({
  initial,
  onChange,
}: {
  initial: Trigger;
  onChange: (trigger: Trigger) => void;
}) {
  const [value, setValue] = useState(initial);
  const options = useOptions(TRIGGER_OPTIONS);
  return (
    <TriggerSelect
      aria-label="Event"
      options={options}
      trigger={value}
      onChange={(changed) => {
        setValue(changed);
        onChange(changed);
      }}
    />
  );
}

const render = (platforms: Platform[], initial = trigger()) => {
  const onChange = vi.fn();
  const view = renderWithProviders(
    <PlatformsContext value={platforms}>
      <Row initial={initial} onChange={onChange} />
    </PlatformsContext>,
  );
  return { ...view, onChange };
};

const events = async (user: ReturnType<typeof render>["user"]) => {
  await user.click(screen.getByRole("combobox", { name: "Event" }));
  const names = screen.getAllByRole("option").map((o) => o.textContent);
  await user.keyboard("{Escape}");
  return names;
};

const pick = async (
  user: ReturnType<typeof render>["user"],
  name: string,
  option: string,
) => {
  await user.click(screen.getByRole("combobox", { name }));
  await user.click(screen.getByRole("option", { name: option }));
};

describe("TriggerSelect", () => {
  it("names a Kick row's gifts Kicks", async () => {
    const { user } = render(
      ["tiktok", "kick"],
      trigger({ type: TOKIO_EVENTS.GIFT, platform: "kick" }),
    );

    expect(await events(user)).toContain("Kicks");
    await pick(user, "Platform", "Any platform");
    expect(await events(user)).toContain("Gift");
  });

  it("has no platform with one, and only its events", async () => {
    const { user } = render(["tiktok"]);

    expect(
      screen.queryByRole("combobox", { name: "Platform" }),
    ).not.toBeInTheDocument();
    const names = await events(user);
    expect(names).toContain("Gift");
    expect(names).toContain("Music change");
    expect(names).not.toContain("Raid");
  });

  it("lists every platform's events under Any, and one's under it", async () => {
    const { user, onChange } = render(["tiktok", "twitch"]);

    expect(
      screen.getByRole("combobox", { name: "Platform" }),
    ).toHaveTextContent("Any platform");
    expect(await events(user)).toEqual(
      expect.arrayContaining(["Gift", "Raid", "Music change"]),
    );

    await pick(user, "Platform", "Twitch");

    // Follow is Twitch's too, so the row keeps it
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: TOKIO_EVENTS.FOLLOW,
        platform: "twitch",
      }),
    );
    const names = await events(user);
    expect(names).toContain("Raid");
    expect(names).not.toContain("Gift");
    expect(names).not.toContain("Music change");
  });

  it("moves a row to the platform's first event when it doesn't send its own", async () => {
    const { user, onChange } = render(
      ["tiktok", "twitch"],
      trigger({ type: TOKIO_EVENTS.GIFT }),
    );

    await pick(user, "Platform", "Twitch");

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: TOKIO_EVENTS.CHAT, platform: "twitch" }),
    );
  });

  it("leaves the platform key out for Any", async () => {
    const { user, onChange } = render(
      ["tiktok", "twitch"],
      trigger({ platform: "twitch" }),
    );

    await pick(user, "Platform", "Any platform");

    const changed = onChange.mock.lastCall![0];
    expect("platform" in changed).toBe(false);
  });

  it("keeps a saved platform the profile no longer uses", async () => {
    const { user } = render(["tiktok"], trigger({ platform: "twitch" }));

    await user.click(screen.getByRole("combobox", { name: "Platform" }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Any platform",
      "TikTok",
      "Twitch",
    ]);
  });

  it("keeps the row's own event in the list", async () => {
    const { user } = render(["twitch"], trigger({ type: TOKIO_EVENTS.GIFT }));

    expect(await events(user)).toContain("Gift");
  });
});

describe("eventsFor", () => {
  it("keeps the editor's events from no platform, Music change only under Any", () => {
    const values = [TOKIO_EVENTS.RAID, TOKIO_EVENTS.MUSIC_CHANGE, GOAL_TRIGGER];

    expect(eventsFor(values, ["twitch"])).toEqual(values);
    expect(eventsFor(values, ["tiktok", "twitch"], "twitch")).toEqual([
      TOKIO_EVENTS.RAID,
      GOAL_TRIGGER,
    ]);
    expect(eventsFor(values, ["tiktok"])).toEqual([
      TOKIO_EVENTS.MUSIC_CHANGE,
      GOAL_TRIGGER,
    ]);
  });
});

describe("withPlatform", () => {
  it("retypes a row moved to a platform without its event", () => {
    const retype = vi.fn((row: Trigger, type: Trigger["type"]): Trigger => ({
      ...row,
      type,
    }));

    withPlatform(
      trigger({ type: TOKIO_EVENTS.GIFT }),
      "twitch",
      [TOKIO_EVENTS.RAID],
      retype,
    );

    expect(retype).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "twitch" }),
      TOKIO_EVENTS.RAID,
    );
  });
});
