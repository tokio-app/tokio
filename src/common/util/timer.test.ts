import { describe, expect, it } from "vitest";
import { TimerSettings, TimerSettingsSchema } from "../schemas/timer";
import { formatAdded, timerTriggers } from "./timer";

describe("formatAdded", () => {
  it("gives seconds, then minutes, then hours", () => {
    expect(formatAdded(5_000)).toBe("5s");
    expect(formatAdded(30_000)).toBe("30s");
    expect(formatAdded(90_000)).toBe("1:30");
    expect(formatAdded(3_600_000)).toBe("1:00:00");
    expect(formatAdded(3_725_000)).toBe("1:02:05");
  });

  it("keeps tenths under 10 s, rounds to the second above, and drops the sign", () => {
    expect(formatAdded(500)).toBe("0.5s");
    expect(formatAdded(1_520)).toBe("1.5s");
    expect(formatAdded(59_600)).toBe("1:00");
    expect(formatAdded(-300_000)).toBe("5:00");
  });
});

describe("timerTriggers", () => {
  const settings = (
    change: (s: TimerSettings) => void = () => {},
  ): TimerSettings => {
    const s = TimerSettingsSchema.parse({});
    change(s);
    return s;
  };

  it("lists the triggers that add time, with their counts and the multiplier", () => {
    expect(
      timerTriggers(
        settings((s) => {
          s.multiplier = 2;
          s.seconds.coin = 0.5;
          s.seconds.likes_every = 50;
        }),
      ),
    ).toEqual([
      { label: "1 coin", value: "+1s" },
      { label: "50 likes", value: "+20s" },
      { label: "New Super Fan", value: "+10:00" },
      { label: "Follow", value: "+1:00" },
      { label: "Share", value: "+20s" },
    ]);
  });

  it("uses the streamer's names, and shows the chat keyword viewers need", () => {
    const triggers = timerTriggers(
      settings((s) => {
        s.seconds = {
          ...s.seconds,
          coin: 0,
          likes: 0,
          superfan: 0,
          follow: 0,
          share: 0,
          chat: 2,
        };
        s.chat.keyword = " !sub ";
        s.look.names.chat = "Escribe";
      }),
    );

    expect(triggers).toEqual([{ label: "Escribe “!sub”", value: "+2s" }]);
  });

  it("shows nothing when the multiplier is 0", () => {
    const off = settings((s) => {
      s.multiplier = 0;
    });

    expect(timerTriggers(off)).toEqual([]);
  });
});
