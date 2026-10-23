import { Alert, AlertTts, Profile } from "@/common/schemas";
import {
  AppEvents,
  ChatEvent,
  EMOTE_TRIGGER,
  GiftEvent,
  TOKIO_EVENTS,
  TokioEventMap,
} from "@/common/types";
import { defaultProfile, delay } from "@/common/util";
import Logger from "@/logger";
import { TTSService } from "@/services/tts";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  truncate,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from "vitest";
import {
  AlertAudio,
  AlertsService,
  CACHE_MAX_BYTES,
  CACHE_MAX_FILE_BYTES,
  MEDIA_MAX_BYTES,
} from "./index";

// A test can make a write or rename fail, or count and hold reads
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: vi.fn(actual.readFile),
    rename: vi.fn(actual.rename),
    writeFile: vi.fn(actual.writeFile),
  };
});

const FIXTURE = resolve("test/fixtures/myinstants-search.html");

const bytes = (...values: number[]) => new Uint8Array(values);

const trigger = (
  type: Alert["trigger"]["type"],
  filters: Partial<Alert["trigger"]> = {},
): Alert["trigger"] => ({
  type,
  gifts: [],
  every_gift: false,
  emotes: [],
  keyword: "",
  user: "",
  ...filters,
});

const alert = (overrides: Partial<Alert> = {}): Alert => ({
  id: "alert-1",
  enabled: true,
  trigger: trigger(TOKIO_EVENTS.FOLLOW),
  sound: { name: "Ding", file: "ding.mp3" },
  tts: null,
  media: null,
  volume: 80,
  ...overrides,
});

const picture = {
  name: "Confetti",
  file: "confetti.gif",
  duration: 5,
  match_video: false,
};

type AlertProfile = Pick<Profile, "alerts" | "tts">;

const settings = (items: Alert[], simultaneous = false): AlertProfile => ({
  alerts: { simultaneous, queue_length: 100, items },
  tts: defaultProfile.tts,
});

const user = { username: "Viewer", handle: "viewer", profilePictures: [] };

const gift = (
  id: string,
  repeatEnd: boolean,
  patch: Partial<GiftEvent["gift"]> = {},
): GiftEvent => ({
  user,
  gift: {
    id,
    coins: 1,
    repeatEnd,
    type: 1,
    name: "Rose",
    comboCount: 1,
    image: "",
    ...patch,
  },
});

const chat = (content: string, ...emoteIDs: string[]): ChatEvent => ({
  user,
  comment: {
    content,
    lang: "en",
    emotes: emoteIDs.map((emoteID, index) => ({
      emoteID,
      index,
      images: [`https://example.com/${emoteID}.webp`],
    })),
  },
});

const htmlResponse = (html: string, status = 200) =>
  new Response(html, { status, headers: { "content-type": "text/html" } });

describe("AlertsService", () => {
  let root: string;
  let sounds: string;
  let service: AlertsService;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "tokio-test-"));
    sounds = join(root, "sounds");
    await mkdir(sounds);
    service = new AlertsService();
    service.setSoundsFolder(sounds);
    await writeFile(join(sounds, "ding.mp3"), bytes(1, 2, 3));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe("handle", () => {
    const run = async <K extends AppEvents>(
      type: K,
      payload: TokioEventMap[K],
      alerts: AlertProfile,
    ) => {
      const sent: AlertAudio[] = [];
      await service.handle(type, payload, alerts, (audio) => sent.push(audio));
      return sent;
    };

    it("sends the sound of a matching alert on the shared queue", async () => {
      const sent = await run(
        TOKIO_EVENTS.FOLLOW,
        { user },
        settings([alert()]),
      );

      expect(sent).toEqual([
        {
          data: bytes(1, 2, 3),
          volume: 80,
          channel: "alerts",
          maxQueueLength: 100,
          id: "alert-1",
          key: "ding.mp3",
        },
      ]);
    });

    it("gives each trigger its own queue when simultaneous", async () => {
      const sent = await run(
        TOKIO_EVENTS.FOLLOW,
        { user },
        settings([alert()], true),
      );

      expect(sent[0].channel).toBe(`alerts:${TOKIO_EVENTS.FOLLOW}`);
    });

    it("sends an alert's media with its sound", async () => {
      const sent = await run(
        TOKIO_EVENTS.FOLLOW,
        { user },
        settings([alert({ media: picture })]),
      );

      expect(sent).toEqual([
        expect.objectContaining({ data: bytes(1, 2, 3), media: picture }),
      ]);
    });

    it("sends an alert with only media, to hold its turn in the queue", async () => {
      const sent = await run(
        TOKIO_EVENTS.FOLLOW,
        { user },
        settings([alert({ sound: null, media: picture })]),
      );

      expect(sent).toEqual([
        {
          volume: 80,
          channel: "alerts",
          maxQueueLength: 100,
          id: "alert-1",
          media: picture,
        },
      ]);
    });

    it("sends every matching alert in order", async () => {
      await writeFile(join(sounds, "pop.mp3"), bytes(9));
      const items = [
        alert({ id: "one" }),
        alert({ id: "two", sound: { name: "Pop", file: "pop.mp3" } }),
      ];

      const sent = await run(TOKIO_EVENTS.FOLLOW, { user }, settings(items));

      expect(sent.map((a) => a.id)).toEqual(["one", "two"]);
    });

    it("skips disabled, silent, unrelated and missing alerts", async () => {
      const items = [
        alert({ enabled: false }),
        alert({ sound: null }),
        alert({ trigger: trigger(TOKIO_EVENTS.SHARE) }),
        alert({ sound: { name: "Gone", file: "gone.mp3" } }),
      ];

      expect(await run(TOKIO_EVENTS.FOLLOW, { user }, settings(items))).toEqual(
        [],
      );
    });

    it("reports the alerts whose sound is missing, for the caller to log", async () => {
      const logError = vi.spyOn(Logger, "error");
      const gone = alert({
        id: "gone",
        sound: { name: "Gone", file: "gone.mp3" },
      });
      const sent: AlertAudio[] = [];
      const onError = vi.fn();

      await service.handle(
        TOKIO_EVENTS.FOLLOW,
        { user },
        settings([gone, alert()]),
        (audio) => sent.push(audio),
        onError,
      );

      expect(onError).toHaveBeenCalledExactlyOnceWith(gone, expect.any(String));
      expect(sent.map((a) => a.id)).toEqual(["alert-1"]);
      expect(logError).not.toHaveBeenCalled();
    });

    it("reads a sound too big to cache once for events at the same time", async () => {
      const big = new Uint8Array(CACHE_MAX_FILE_BYTES + 1);
      await writeFile(join(sounds, "long.mp3"), big);
      const items = [alert({ sound: { name: "Long", file: "long.mp3" } })];
      const sent: AlertAudio[] = [];

      await Promise.all(
        Array.from({ length: 50 }, () =>
          service.handle(TOKIO_EVENTS.FOLLOW, { user }, settings(items), (a) =>
            sent.push(a),
          ),
        ),
      );

      expect(sent).toHaveLength(50);
      expect(new Set(sent.map((a) => a.data)).size).toBe(1);
      expect(
        vi
          .mocked(readFile)
          .mock.calls.filter(([path]) => path === join(sounds, "long.mp3")),
      ).toHaveLength(1);
    });

    it("fires gift alerts once per combo, when it ends", async () => {
      const alerts = settings([alert({ trigger: trigger(TOKIO_EVENTS.GIFT) })]);

      expect(await run(TOKIO_EVENTS.GIFT, gift("5655", false), alerts)).toEqual(
        [],
      );
      expect(
        await run(TOKIO_EVENTS.GIFT, gift("5655", true), alerts),
      ).toHaveLength(1);
    });

    it("only fires gift alerts for the chosen gifts", async () => {
      const alerts = settings([
        alert({ trigger: trigger(TOKIO_EVENTS.GIFT, { gifts: [5655] }) }),
      ]);

      expect(
        await run(TOKIO_EVENTS.GIFT, gift("5655", true), alerts),
      ).toHaveLength(1);
      expect(await run(TOKIO_EVENTS.GIFT, gift("1", true), alerts)).toEqual([]);
    });

    describe("on every gift", () => {
      const everyGift = settings([
        alert({ trigger: trigger(TOKIO_EVENTS.GIFT, { every_gift: true }) }),
      ]);
      // A streak's update, and the event that ends it
      const update = (comboCount: number) =>
        gift("5655", false, { comboCount });
      const end = (comboCount: number) => gift("5655", true, { comboCount });

      // How many times the alerts play for each event, in order
      const plays = async (events: GiftEvent[], alerts = everyGift) => {
        const counts: number[] = [];
        for (const event of events) {
          counts.push((await run(TOKIO_EVENTS.GIFT, event, alerts)).length);
        }
        return counts;
      };

      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it("plays once for each gift sent, as the gift jar counts them", async () => {
        // The same count again is the gift sent again, a count that grows adds
        // the growth, and the end adds nothing
        expect(await plays([update(1), update(1), update(3), end(3)])).toEqual([
          1, 1, 2, 0,
        ]);
      });

      it("plays for gifts only the streak's end has", async () => {
        expect(await plays([update(1), end(2)])).toEqual([1, 1]);
      });

      it("skips an update that came late, not a new streak", async () => {
        expect(await plays([update(5), update(4)])).toEqual([5, 0]);

        vi.advanceTimersByTime(2000);
        expect(await plays([update(2)])).toEqual([2]);
      });

      it("plays once for a gift that can't be sent in a streak", async () => {
        const galaxy = gift("11046", true, { type: 2 });

        expect(await plays([galaxy, galaxy])).toEqual([1, 1]);
      });

      it("counts each viewer's streak apart", async () => {
        const other = (comboCount: number): GiftEvent => ({
          ...update(comboCount),
          user: { ...user, username: "Other", handle: "other" },
        });

        expect(await plays([update(1), other(1), update(2), other(3)])).toEqual(
          [1, 1, 1, 2],
        );
      });

      it("keeps counting while no alert plays on every gift", async () => {
        const atEnd = settings([
          alert({ trigger: trigger(TOKIO_EVENTS.GIFT) }),
        ]);

        expect(await plays([update(1), update(2)], atEnd)).toEqual([0, 0]);
        expect(await plays([update(3)])).toEqual([1]);
      });

      it("starts the streaks over when cleared, as their ends may be missed", async () => {
        expect(await plays([update(5)])).toEqual([5]);
        service.clear();
        expect(await plays([update(3)])).toEqual([3]);
      });

      it("plays no more times than the queue takes", async () => {
        expect(await plays([update(250)])).toEqual([100]);
      });

      it("leaves alerts on the streak's end playing once, when it ends", async () => {
        const items = [
          alert({
            id: "every",
            trigger: trigger(TOKIO_EVENTS.GIFT, { every_gift: true }),
          }),
          alert({ id: "end", trigger: trigger(TOKIO_EVENTS.GIFT) }),
        ];
        const ids = async (event: GiftEvent) =>
          (await run(TOKIO_EVENTS.GIFT, event, settings(items))).map(
            (a) => a.id,
          );

        expect(await ids(update(1))).toEqual(["every"]);
        expect(await ids(update(2))).toEqual(["every"]);
        expect(await ids(end(2))).toEqual(["end"]);
      });
    });

    it("sends no sound read while the alerts were cleared", async () => {
      const sent: AlertAudio[] = [];

      const handled = service.handle(
        TOKIO_EVENTS.FOLLOW,
        { user },
        settings([alert(), alert({ id: "two" })]),
        (audio) => sent.push(audio),
      );
      service.clear();
      await handled;

      expect(sent).toEqual([]);
    });

    it("fires chat alerts without a keyword on every message", async () => {
      const alerts = settings([alert({ trigger: trigger(TOKIO_EVENTS.CHAT) })]);

      expect(await run(TOKIO_EVENTS.CHAT, chat("hello"), alerts)).toHaveLength(
        1,
      );
    });

    it("only fires chat alerts on messages with the keyword", async () => {
      const alerts = settings([
        alert({ trigger: trigger(TOKIO_EVENTS.CHAT, { keyword: "hi" }) }),
      ]);

      expect(
        await run(TOKIO_EVENTS.CHAT, chat("Hi there!"), alerts),
      ).toHaveLength(1);
      expect(await run(TOKIO_EVENTS.CHAT, chat("this"), alerts)).toEqual([]);
    });

    it("fires emote alerts without picks on chats with any emote", async () => {
      const alerts = settings([alert({ trigger: trigger(EMOTE_TRIGGER) })]);

      expect(await run(TOKIO_EVENTS.CHAT, chat("", "e1"), alerts)).toHaveLength(
        1,
      );
      expect(await run(TOKIO_EVENTS.CHAT, chat("hello"), alerts)).toEqual([]);
      expect(await run(TOKIO_EVENTS.FOLLOW, { user }, alerts)).toEqual([]);
    });

    it("only fires emote alerts for the picked emotes, once per chat", async () => {
      const alerts = settings([
        alert({ trigger: trigger(EMOTE_TRIGGER, { emotes: ["e1"] }) }),
      ]);

      expect(
        await run(TOKIO_EVENTS.CHAT, chat("", "e1", "e1", "e2"), alerts),
      ).toHaveLength(1);
      expect(await run(TOKIO_EVENTS.CHAT, chat("", "e2"), alerts)).toEqual([]);
    });

    it("gives emote alerts their own queue when simultaneous", async () => {
      const items = [
        alert({ id: "chat", trigger: trigger(TOKIO_EVENTS.CHAT) }),
        alert({ id: "emote", trigger: trigger(EMOTE_TRIGGER) }),
      ];

      const sent = await run(
        TOKIO_EVENTS.CHAT,
        chat("", "e1"),
        settings(items, true),
      );

      expect(sent.map((a) => a.channel)).toEqual([
        `alerts:${TOKIO_EVENTS.CHAT}`,
        `alerts:${EMOTE_TRIGGER}`,
      ]);
    });

    it.each([TOKIO_EVENTS.MEMBER_JOIN, TOKIO_EVENTS.SUPER_FAN_JOIN] as const)(
      "fires %s alerts for anyone or only for the named viewer",
      async (type) => {
        const anyone = settings([alert({ trigger: trigger(type) })]);
        const named = settings([
          alert({ trigger: trigger(type, { user: "@Viewer" }) }),
        ]);
        const other = { ...user, username: "Other", handle: "other" };

        expect(await run(type, { user: other }, anyone)).toHaveLength(1);
        expect(await run(type, { user }, named)).toHaveLength(1);
        expect(await run(type, { user: other }, named)).toEqual([]);
      },
    );

    describe("text-to-speech", () => {
      const voice = { engine: "Edge", name: "Ava", lang: "en-US" };
      const tts = (message: string): AlertTts => ({
        voice,
        message,
        speed: 1.5,
        pitch: 0.8,
      });
      const speaking = (message: string, sound: Alert["sound"] = null) =>
        alert({
          trigger: trigger(TOKIO_EVENTS.GIFT),
          sound,
          tts: tts(message),
        });
      const said = (audio: AlertAudio) => Buffer.from(audio.data!).toString();
      const giftFrom = (username: string): GiftEvent => ({
        ...gift("5655", true),
        user: { ...user, username },
      });

      // The TTS settings, with no cooldown unless changed
      const withTts = (
        items: Alert[],
        change: (p: Profile["tts"]["protection"]) => void = () => {},
      ): AlertProfile => {
        const tts = structuredClone(defaultProfile.tts);
        tts.protection.cooldown = 0;
        change(tts.protection);
        return { ...settings(items), tts };
      };

      let prepareText: Mock;
      let generateBuffer: Mock;
      let sent: AlertAudio[];
      let onError: Mock;

      beforeEach(() => {
        vi.useFakeTimers();
        prepareText = vi.fn((text: string) => text);
        generateBuffer = vi.fn(async (text: string) => ({
          success: true,
          buffer: Buffer.from(text),
        }));
        service.setSpeaker({ prepareText, generateBuffer });
        sent = [];
        onError = vi.fn();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      const handle = (payload: GiftEvent, alerts: AlertProfile) =>
        service.handle(
          TOKIO_EVENTS.GIFT,
          payload,
          alerts,
          (audio) => sent.push(audio),
          onError,
        );

      // Runs the alerts, then lets the queued messages be made.
      const speak = async (payload: GiftEvent, alerts: AlertProfile) => {
        await handle(payload, alerts);
        await vi.advanceTimersByTimeAsync(0);
      };

      // Each message takes a second to make.
      const slowly = () =>
        generateBuffer.mockImplementation(async (text: string) => {
          await delay(1000);
          return { success: true, buffer: Buffer.from(text) };
        });

      it("speaks the message filled with the event, at its speed and pitch", async () => {
        await speak(
          gift("5655", true),
          withTts([speaking("Thanks {username} for the {gift}")]),
        );

        expect(generateBuffer).toHaveBeenCalledExactlyOnceWith(
          "Thanks Viewer for the Rose",
          voice,
        );
        expect(sent).toHaveLength(1);
        expect(said(sent[0])).toBe("Thanks Viewer for the Rose");
        expect(sent[0]).toMatchObject({
          volume: 80,
          channel: "alerts",
          id: "alert-1",
          key: expect.stringMatching(/^tts:/),
          filters: { speed: 1.5, pitch: 0.8 },
        });
      });

      it("speaks with the alert's media", async () => {
        await speak(
          gift("5655", true),
          withTts([{ ...speaking("Thanks"), media: picture }]),
        );

        expect(sent).toEqual([expect.objectContaining({ media: picture })]);
      });

      it("speaks instead of playing the sound", async () => {
        await speak(
          gift("5655", true),
          withTts([speaking("Thanks", { name: "Ding", file: "ding.mp3" })]),
        );

        expect(sent.map(said)).toEqual(["Thanks"]);
      });

      it("stays silent when the TTS settings block the message", async () => {
        prepareText.mockReturnValue(null);
        const alerts = withTts([speaking("Thanks {username}")]);

        await speak(gift("5655", true), alerts);

        expect(prepareText).toHaveBeenCalledWith(
          "Thanks Viewer",
          alerts.tts,
          "Viewer",
        );
        expect(generateBuffer).not.toHaveBeenCalled();
        expect(sent).toEqual([]);
        expect(onError).not.toHaveBeenCalled();
      });

      it("checks banned words in the event's values, not the message's own", async () => {
        const tts = new TTSService();
        service.setSpeaker({
          prepareText: tts.prepareText.bind(tts),
          generateBuffer,
        });
        const alerts = withTts(
          [speaking("Thanks {username} for the follow")],
          (p) => {
            p.banned = ["follow"];
          },
        );

        await speak(giftFrom("Viewer"), alerts);
        await speak(giftFrom("Follow Bot"), alerts);

        expect(sent.map(said)).toEqual(["Thanks Viewer for the follow"]);
      });

      it("reports a message that can't be spoken", async () => {
        generateBuffer.mockResolvedValue({
          success: false,
          error: new Error("offline"),
        });
        const failing = speaking("Thanks");

        await speak(gift("5655", true), withTts([failing]));

        expect(onError).toHaveBeenCalledExactlyOnceWith(failing, "offline");
      });

      it("makes the same message once", async () => {
        const alerts = withTts([speaking("Thanks for the {gift}")]);

        await speak(gift("5655", true), alerts);
        await speak(gift("5655", true), alerts);

        expect(generateBuffer).toHaveBeenCalledOnce();
        expect(sent.map(said)).toEqual([
          "Thanks for the Rose",
          "Thanks for the Rose",
        ]);
        // So the window decodes it once too
        expect(sent[1].key).toBe(sent[0].key);
      });

      it("makes one message for the gifts an update adds, on every gift", async () => {
        const everyGift = {
          ...speaking("Thanks {username}"),
          trigger: trigger(TOKIO_EVENTS.GIFT, { every_gift: true }),
        };

        await speak(
          gift("5655", false, { comboCount: 3 }),
          withTts([everyGift]),
        );

        expect(generateBuffer).toHaveBeenCalledOnce();
        expect(sent.map(said)).toEqual([
          "Thanks Viewer",
          "Thanks Viewer",
          "Thanks Viewer",
        ]);
      });

      it("says the streak's count so far, as the gift jar counts it", async () => {
        const everyGift = {
          ...speaking("{count} roses"),
          trigger: trigger(TOKIO_EVENTS.GIFT, { every_gift: true }),
        };
        const alerts = withTts([everyGift]);

        for (const comboCount of [1, 1, 3]) {
          await speak(gift("5655", false, { comboCount }), alerts);
        }

        expect(sent.map(said)).toEqual([
          "1 roses",
          "2 roses",
          "4 roses",
          "4 roses",
        ]);
      });

      it("says the whole streak's count when it ends", async () => {
        const alerts = withTts([speaking("{count} roses")]);

        for (const comboCount of [1, 1, 3]) {
          await speak(gift("5655", false, { comboCount }), alerts);
        }
        await speak(gift("5655", true, { comboCount: 3 }), alerts);

        expect(sent.map(said)).toEqual(["4 roses"]);
      });

      it("makes one message at a time, with the TTS cooldown between them", async () => {
        const alerts = withTts([speaking("Thanks {username}")], (p) => {
          p.cooldown = 2;
        });

        await handle(giftFrom("Ann"), alerts);
        await handle(giftFrom("Bob"), alerts);
        await vi.advanceTimersByTimeAsync(0);
        expect(sent.map(said)).toEqual(["Thanks Ann"]);

        await vi.advanceTimersByTimeAsync(2000);
        expect(sent.map(said)).toEqual(["Thanks Ann", "Thanks Bob"]);
        expect(sent[1].key).not.toBe(sent[0].key);
      });

      it("drops messages beyond the TTS queue length", async () => {
        slowly();
        const alerts = withTts([speaking("Thanks {username}")], (p) => {
          p.queue_length = 1;
        });

        // Ann is being made, Bob waits and Cid doesn't fit.
        for (const name of ["Ann", "Bob", "Cid"]) {
          await handle(giftFrom(name), alerts);
        }
        await vi.advanceTimersByTimeAsync(3000);

        expect(generateBuffer).toHaveBeenCalledTimes(2);
        expect(sent.map(said)).toEqual(["Thanks Ann", "Thanks Bob"]);
      });

      it("drops the waiting messages and the one being made when cleared", async () => {
        slowly();
        const alerts = withTts([speaking("Thanks {username}")]);

        await handle(giftFrom("Ann"), alerts);
        await handle(giftFrom("Bob"), alerts);
        service.clear();
        await vi.advanceTimersByTimeAsync(3000);

        expect(generateBuffer).toHaveBeenCalledOnce();
        expect(sent).toEqual([]);
      });
    });
  });

  describe("readSound", () => {
    it("never reads outside the sounds folder", async () => {
      await writeFile(join(root, "secret.mp3"), bytes(7));

      const res = await service.readSound("../secret.mp3", false);

      expect(res.success).toBe(false);
    });

    it("keeps the most recently used sounds that fit in memory", async () => {
      // The largest cached files, so one more than fit pushes one out.
      const fit = CACHE_MAX_BYTES / CACHE_MAX_FILE_BYTES;
      const names = Array.from({ length: fit + 1 }, (_, i) => `s${i}.mp3`);
      await Promise.all(
        names.map((name, i) => {
          const data = new Uint8Array(CACHE_MAX_FILE_BYTES);
          data[0] = i;
          return writeFile(join(sounds, name), data);
        }),
      );

      for (const name of names.slice(0, fit)) await service.readSound(name);
      // Using s0 again makes s1 the oldest.
      await service.readSound("s0.mp3");
      await service.readSound(names[fit]);

      await unlink(join(sounds, "s0.mp3"));
      await unlink(join(sounds, "s1.mp3"));

      expect((await service.readSound("s0.mp3")).data?.[0]).toBe(0);
      expect((await service.readSound("s1.mp3", false)).success).toBe(false);
    });

    it("reads sounds too big to cache from disk every time", async () => {
      const name = "long.mp3";
      await writeFile(
        join(sounds, name),
        new Uint8Array(CACHE_MAX_FILE_BYTES + 1),
      );

      expect((await service.readSound(name)).success).toBe(true);
      await unlink(join(sounds, name));

      expect((await service.readSound(name, false)).success).toBe(false);
    });

    it("deleteSound removes the file and the cached copy", async () => {
      await service.readSound("ding.mp3");

      expect((await service.deleteSound("ding.mp3")).success).toBe(true);

      expect(await readdir(sounds)).toEqual([]);
      expect((await service.readSound("ding.mp3", false)).success).toBe(false);
    });

    it("doesn't cache a sound deleted while it was read", async () => {
      let finish!: () => void;
      const held = new Promise<void>((resolve) => (finish = resolve));
      // Not from disk: the delete could get there before the read opens the file
      vi.mocked(readFile).mockImplementationOnce(async () => {
        await held;
        return Buffer.from([1, 2, 3]);
      });

      const reading = service.readSound("ding.mp3");
      await service.deleteSound("ding.mp3");
      finish();

      expect((await reading).data).toEqual(bytes(1, 2, 3));
      expect((await service.readSound("ding.mp3", false)).success).toBe(false);
    });
  });

  describe("importSound", () => {
    let src: string;

    beforeEach(async () => {
      src = join(root, "src");
      await mkdir(src);
    });

    it("names the copy by its content and keeps the file name as label", async () => {
      await writeFile(join(src, "My Sound.MP3"), bytes(4, 5));

      const res = await service.importSound(join(src, "My Sound.MP3"));

      expect(res.success).toBe(true);
      expect(res.data?.name).toBe("My Sound");
      expect(res.data?.file).toMatch(/^[0-9a-f]{32}\.mp3$/);
      expect(await readFile(join(sounds, res.data!.file))).toEqual(
        Buffer.from([4, 5]),
      );
    });

    // Windows antivirus and indexers hold a file they just saw for a moment.
    it("waits out a file another program holds", async () => {
      await writeFile(join(src, "a.wav"), bytes(4, 5));
      vi.mocked(rename).mockRejectedValueOnce(
        Object.assign(new Error("EBUSY: rename"), { code: "EBUSY" }),
      );

      const res = await service.importSound(join(src, "a.wav"));

      expect(res.success).toBe(true);
      expect(await readdir(sounds)).toContain(res.data!.file);
    });

    it("stores the same audio once", async () => {
      await writeFile(join(src, "a.wav"), bytes(4, 5));
      await writeFile(join(src, "b.wav"), bytes(4, 5));

      const a = await service.importSound(join(src, "a.wav"));
      const b = await service.importSound(join(src, "b.wav"));

      expect(a.data?.file).toBe(b.data?.file);
      expect(await readdir(sounds)).toHaveLength(2); // ding.mp3 + the import
    });

    it("refuses sounds too big to keep in memory", async () => {
      await writeFile(join(src, "long.mp3"), new Uint8Array(9 * 1024 * 1024));

      const res = await service.importSound(join(src, "long.mp3"));

      expect(res.success).toBe(false);
      expect(await readdir(sounds)).toEqual(["ding.mp3"]);
    });

    it("rejects formats that are not audio", async () => {
      await writeFile(join(src, "notes.txt"), "hi");

      const res = await service.importSound(join(src, "notes.txt"));

      expect(res.success).toBe(false);
      expect(res.error).toContain("Unsupported format");
    });
  });

  describe("media", () => {
    let src: string;
    let media: string;

    beforeEach(async () => {
      src = join(root, "src");
      media = join(root, "media");
      await mkdir(src);
      await mkdir(media);
      service.setMediaFolder(media);
    });

    it("names an imported image or video by its content", async () => {
      await writeFile(join(src, "Party.GIF"), bytes(4, 5));

      const res = await service.importMedia(join(src, "Party.GIF"));

      expect(res.data?.name).toBe("Party");
      expect(res.data?.file).toMatch(/^[0-9a-f]{32}\.gif$/);
      expect(await readdir(media)).toEqual([res.data!.file]);
    });

    it("refuses files that are too big, or not images or videos", async () => {
      await writeFile(join(src, "icon.svg"), "<svg/>");
      await writeFile(join(src, "song.mp3"), bytes(1));
      // Sparse, so nothing big is written
      await writeFile(join(src, "long.mp4"), "");
      await truncate(join(src, "long.mp4"), MEDIA_MAX_BYTES + 1);

      for (const name of ["icon.svg", "song.mp3", "long.mp4"]) {
        expect((await service.importMedia(join(src, name))).success).toBe(
          false,
        );
      }
      expect(await readdir(media)).toEqual([]);
    });

    it("deletes a file", async () => {
      await writeFile(join(media, "a.png"), bytes(1));

      expect((await service.deleteMedia("a.png")).success).toBe(true);
      expect(await readdir(media)).toEqual([]);
    });
  });

  describe("showMedia", () => {
    const show = {
      id: "alert-1",
      file: "a.png",
      delay: 2,
      duration: 6.5,
      volume: 80,
    };
    let sendToClient: Mock;

    beforeEach(() => {
      vi.useFakeTimers();
      sendToClient = vi.fn(() => true);
      service.setServer({ sendToClient });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("sends the media to the alert's overlay when its turn comes", () => {
      service.showMedia(show);
      service.showMedia({ ...show, id: "alert-2", file: "b.WEBM" });

      vi.advanceTimersByTime(1999);
      expect(sendToClient).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(sendToClient.mock.calls).toEqual([
        [
          "alert-1",
          {
            type: "tokio:alert:media",
            data: {
              src: "/alerts/media/a.png",
              kind: "image",
              duration: 6.5,
              volume: 80,
            },
          },
        ],
        [
          "alert-2",
          expect.objectContaining({
            data: expect.objectContaining({ kind: "video" }),
          }),
        ],
      ]);
    });

    it("keeps the numbers in range", () => {
      service.showMedia({ ...show, delay: -1, duration: 1e12, volume: 150 });
      vi.advanceTimersByTime(0);

      expect(sendToClient.mock.calls[0][1].data).toMatchObject({
        duration: 24 * 60 * 60,
        volume: 100,
      });
    });

    it("refuses paths, other files and numbers that aren't", () => {
      const warn = vi.spyOn(Logger, "warn");
      const refused = [
        { file: "../a.png" },
        { file: "dir/a.png" },
        { file: "a.svg" },
        { delay: NaN },
        { volume: Infinity },
      ];

      for (const change of refused) service.showMedia({ ...show, ...change });
      vi.runAllTimers();

      expect(sendToClient).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(refused.length);
    });

    it("drops the media waiting on clear, and hides what overlays show", () => {
      service.showMedia({ ...show, delay: 0 });
      vi.advanceTimersByTime(0);
      service.showMedia({ ...show, id: "alert-2" });

      service.clear();
      vi.runAllTimers();
      service.clear();

      expect(sendToClient.mock.calls.map(([id, p]) => [id, p.type])).toEqual([
        ["alert-1", "tokio:alert:media"],
        ["alert-1", "tokio:alert:clear"],
      ]);
    });
  });

  describe("MyInstants", () => {
    const SOUND_URL = "https://www.myinstants.com/media/sounds/movie_1.mp3";

    it("refuses to fetch other hosts", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      for (const url of [
        "https://evil.example/x.mp3",
        "https://www.myinstants.com.evil.example/x.mp3",
        "http://www.myinstants.com/x.mp3",
        "not a url",
      ]) {
        expect((await service.fetchSound(url)).success).toBe(false);
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("fetches a sound once, then serves it from memory", async () => {
      const fetchMock = vi.fn(async () => new Response(bytes(1, 1)));
      vi.stubGlobal("fetch", fetchMock);

      await service.fetchSound(SOUND_URL);
      const res = await service.fetchSound(SOUND_URL);

      expect(res.data).toEqual(bytes(1, 1));
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("downloads a sound to disk only once", async () => {
      const fetchMock = vi.fn(async () => new Response(bytes(1, 1)));
      vi.stubGlobal("fetch", fetchMock);

      const first = await service.downloadSound(SOUND_URL, "BRUH");
      // A new instance has no memory cache, so only the file can stop a fetch.
      const fresh = new AlertsService();
      fresh.setSoundsFolder(sounds);
      const again = await fresh.downloadSound(SOUND_URL, "BRUH");

      expect(first).toEqual(again);
      expect(first.data?.name).toBe("BRUH");
      expect(await readdir(sounds)).toContain(first.data?.file);
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("saves nothing when MyInstants doesn't send the sound", async () => {
      const fetchMock = vi.fn(
        async () => new Response("gone", { status: 404 }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const failed = await service.downloadSound(SOUND_URL, "BRUH");
      await service.downloadSound(SOUND_URL, "BRUH");

      expect(failed.success).toBe(false);
      expect(await readdir(sounds)).toEqual(["ding.mp3"]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("saves a sound whole or not at all", async () => {
      const fetchMock = vi.fn(async () => new Response(bytes(1, 1)));
      vi.stubGlobal("fetch", fetchMock);
      const actual =
        await vi.importActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        );
      vi.mocked(writeFile).mockImplementationOnce(async (file) => {
        await actual.writeFile(file, bytes(1));
        throw new Error("Disk full");
      });

      const failed = await service.downloadSound(SOUND_URL, "BRUH");
      const left = await readdir(sounds);
      // A new instance has no memory cache, so only a file can stop a fetch.
      const fresh = new AlertsService();
      fresh.setSoundsFolder(sounds);
      const saved = await fresh.downloadSound(SOUND_URL, "BRUH");

      expect(failed.success).toBe(false);
      expect(left).toEqual(["ding.mp3"]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(await readFile(join(sounds, saved.data!.file))).toEqual(
        Buffer.from([1, 1]),
      );
    });

    it("parses search results with the file each saves to", async () => {
      const html = await readFile(FIXTURE, "utf-8");
      const fetchMock = vi.fn(async (url: string) =>
        url.endsWith(".mp3") ? new Response(bytes(1)) : htmlResponse(html),
      );
      vi.stubGlobal("fetch", fetchMock);
      const download = await service.downloadSound(SOUND_URL, "BRUH");

      const res = await service.search("bruh");

      expect(fetchMock).toHaveBeenLastCalledWith(
        "https://www.myinstants.com/search/?name=bruh&page=1",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(res).toEqual({
        success: true,
        data: {
          hasNextPage: false,
          sounds: [
            { name: "BRUH", url: SOUND_URL, file: download.data?.file },
            {
              name: "yeah boiii i i i",
              url: "https://www.myinstants.com/media/sounds/yeah-boiii-i-i-i.mp3",
              file: expect.stringMatching(/^[0-9a-f]{32}\.mp3$/),
            },
          ],
        },
      });
    });

    it("reports a next page when the page is full", async () => {
      const instant = (i: number) =>
        `<div class="instant"><button class="small-button" onclick="play('/media/sounds/${i}.mp3', 'loader-${i}', '${i}')"></button><a class="instant-link">Sound ${i}</a></div>`;
      const html = `<div id="instants_container"><div class="instants result-page">${Array.from({ length: 36 }, (_, i) => instant(i)).join("")}</div></div>`;
      vi.stubGlobal("fetch", async () => htmlResponse(html));

      const res = await service.getTrending(2);

      expect(res.data?.sounds).toHaveLength(36);
      expect(res.data?.hasNextPage).toBe(true);
    });

    it("treats a 404 as the end of the results", async () => {
      vi.stubGlobal("fetch", async () => htmlResponse("", 404));

      expect(await service.search("nothing", 9)).toEqual({
        success: true,
        data: { sounds: [], hasNextPage: false },
      });
    });

    it("fails on other errors and invalid pages", async () => {
      vi.stubGlobal("fetch", async () => htmlResponse("", 500));

      expect((await service.search("x")).success).toBe(false);
      expect((await service.getTrending(0)).success).toBe(false);
    });

    it("gives up on a request that doesn't answer", async () => {
      const controller = new AbortController();
      const timeout = vi
        .spyOn(AbortSignal, "timeout")
        .mockReturnValue(controller.signal);
      vi.stubGlobal(
        "fetch",
        (_url: string, init: RequestInit) =>
          new Promise((_, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(init.signal?.reason),
            );
          }),
      );

      const pending = service.search("x");
      controller.abort(new DOMException("timeout", "TimeoutError"));

      expect((await pending).success).toBe(false);
      expect(timeout).toHaveBeenCalledWith(15_000);
    });
  });
});
