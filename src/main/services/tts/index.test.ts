import { Profile } from "@/common/schemas";
import { ChatEvent, UserData } from "@/common/types";
import { defaultProfile } from "@/common/util";
import Logger from "@/logger";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import { TTSService } from "./index";

// Real providers spawn PowerShell or call online services.
vi.mock("./providers", async () => {
  const { TTSProvider } = await import("./common");
  class FakeTTS extends TTSProvider {
    label = "Fake";
    setKey(_key: string) {}
    getVoices() {
      return [{ name: "Fake", lang: "en" }];
    }
    async generateBuffer(text: string) {
      return { success: true, buffer: Buffer.from(text) };
    }
  }
  return { TikTokTTS: FakeTTS, WindowsTTS: FakeTTS, EdgeTTS: FakeTTS };
});

type TTSSettings = Profile["tts"];

const settings = (change: (s: TTSSettings) => void = () => {}): TTSSettings => {
  const s = structuredClone(defaultProfile.tts);
  s.protection.cooldown = 0;
  s.format.template = "";
  change(s);
  return s;
};

const viewer: UserData = {
  username: "Viewer",
  handle: "viewer",
  profilePictures: [],
};

const chat = (content: string, user: UserData = viewer): ChatEvent => ({
  user,
  comment: { content, emotes: [], lang: "en" },
});

describe("TTSService", () => {
  let service: TTSService;

  beforeEach(() => {
    service = new TTSService();
  });

  // Resolves with what was sent to the speakers, if anything, played at once.
  const say = async (comment: string | ChatEvent, s = settings()) => {
    const spoken: string[] = [];
    service.talk(
      typeof comment === "string" ? chat(comment) : comment,
      s,
      (res) => {
        spoken.push(res.data?.toString() ?? "");
        service.played(res.id);
      },
    );
    await new Promise((r) => setTimeout(r));
    return spoken;
  };

  const engine = (name: string) => service["_providerPool"].get(name)!;

  describe("engines", () => {
    it("lists every engine, Default first", () => {
      const engines = service.getEngines();

      expect(engines[0]).toEqual({ id: "Default", label: "Fake" });
      expect(engines.map((e) => e.id)).toContain("Edge");
    });

    it("lists the voices of every engine, tagged with it", async () => {
      const voices = await service.getVoices();

      expect(voices).toContainEqual({
        engine: "Default",
        name: "Fake",
        lang: "en",
      });
      expect(voices).toContainEqual({
        engine: "Edge",
        name: "Fake",
        lang: "en",
      });
    });

    it("leaves out the voices of an engine that fails", async () => {
      const error = vi.spyOn(Logger, "error");
      vi.spyOn(engine("Edge"), "getVoices").mockRejectedValue(
        new Error("offline"),
      );

      const voices = await service.getVoices();

      expect(voices.some((v) => v.engine === "Edge")).toBe(false);
      expect(voices.some((v) => v.engine === "Default")).toBe(true);
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining("Edge voices - offline"),
        undefined,
        expect.any(Error),
      );
    });

    it("returns no voices when every engine fails", async () => {
      vi.spyOn(Logger, "error");
      for (const { id } of service.getEngines()) {
        vi.spyOn(engine(id), "getVoices").mockImplementation(() => {
          throw new Error("offline");
        });
      }

      expect(await service.getVoices()).toEqual([]);
    });

    it("speaks with the voice's engine", async () => {
      const edge = vi.spyOn(engine("Edge"), "generateBuffer");
      const tiktok = vi.spyOn(engine("Default"), "generateBuffer");

      await service.generateBuffer("hi", {
        engine: "Edge",
        name: "Jorge",
        lang: "es-MX",
      });

      expect(edge).toHaveBeenCalledExactlyOnceWith("hi", "es-MX", "Jorge");
      expect(tiktok).not.toHaveBeenCalled();
    });

    it.each(["", "Missing"])(
      'speaks voices with the engine "%s" with the active provider',
      async (name) => {
        service.setProvider("Edge");
        const edge = vi.spyOn(engine("Edge"), "generateBuffer");

        await service.generateBuffer("hi", {
          engine: name,
          name: "Jorge",
          lang: "es-MX",
        });

        expect(edge).toHaveBeenCalledExactlyOnceWith("hi", "es-MX", "Jorge");
      },
    );

    it("gives a key only to its engine", () => {
      const tiktok = vi.spyOn(engine("Default"), "setKey");
      const edge = vi.spyOn(engine("Edge"), "setKey");

      service.setEngineKey("Default", "session");
      service.setEngineKey("Missing", "session");

      expect(tiktok).toHaveBeenCalledExactlyOnceWith("session");
      expect(edge).not.toHaveBeenCalled();
    });

    it("gives a key without the spaces around it", () => {
      const tiktok = vi.spyOn(engine("Default"), "setKey");

      service.setEngineKey("Default", " session\n");

      expect(tiktok).toHaveBeenCalledExactlyOnceWith("session");
    });
  });

  it("passes the profile's filters and queue options along", async () => {
    const s = settings((s) => {
      s.filters.pitch = 1.5;
      s.protection.queue_length = 3;
    });
    const callback = vi.fn();

    service.talk(chat("hi"), s, callback);
    await new Promise((r) => setTimeout(r));

    expect(callback).toHaveBeenCalledWith({
      id: 1,
      data: Buffer.from("hi"),
      filters: s.filters,
      queueOptions: { gapTime: 0, maxQueueLength: 3 },
    });
  });

  describe("filters", () => {
    it("ignores comments with nothing to read, not even the name", async () => {
      const s = settings((s) => {
        s.format.template = "{username} {comment}";
        s.replacements = [{ old: "lol", new: "" }];
      });

      expect(await say("", s)).toEqual([]);
      expect(await say("  ", s)).toEqual([]);
      expect(await say("lol", s)).toEqual([]);
    });

    it("ignores comments of only invisible characters", async () => {
      const s = settings((s) => {
        s.format.template = "{username} {comment}";
      });

      for (const blank of [
        "\u200B\u200D",
        "\u3164",
        "\u115F\u1160",
        "\uFFA0",
        "\u2800 \u2800",
      ]) {
        expect(await say(blank, s)).toEqual([]);
      }
    });

    it("needs the trigger prefix unless the mode is any", async () => {
      const s = settings((s) => {
        s.format.trigger = { mode: "custom", value: "!tts" };
      });

      expect(await say("hello", s)).toEqual([]);
      expect(await say("!tts hello", s)).toEqual(["hello"]);
      expect(await say("!Tts hi", s)).toEqual(["hi"]);
    });

    it("reads nothing with a blank custom command", async () => {
      const s = settings((s) => {
        s.format.trigger = { mode: "custom", value: " " };
      });

      expect(await say("hello", s)).toEqual([]);
      s.format.trigger.value = "";
      expect(await say("hello", s)).toEqual([]);
    });

    it("skips a comment with only the trigger", async () => {
      const s = settings((s) => {
        s.format.trigger = { mode: "custom", value: "!tts" };
        s.format.template = "{username} says {comment}";
        s.format.remove_emojis = true;
      });

      expect(await say("!tts", s)).toEqual([]);
      expect(await say("!tts 🎉", s)).toEqual([]);
    });

    it("drops comments with banned words, ignoring case", async () => {
      const s = settings((s) => {
        s.protection.banned = ["Spoiler"];
      });

      expect(await say("big SPOILERS ahead", s)).toEqual([]);
      expect(await say("no secrets", s)).toHaveLength(1);
    });

    it("drops banned words in other letters, accents or hidden characters", async () => {
      const s = settings((s) => {
        s.protection.banned = ["idiot", "Ídolo"];
      });

      expect(await say("you ｉｄｉｏｔ", s)).toEqual([]);
      expect(await say("you i\u200Bdiot", s)).toEqual([]);
      expect(await say("you ídíot", s)).toEqual([]);
      expect(await say("mi idolo", s)).toEqual([]);
      expect(await say("you idol", s)).toHaveLength(1);
    });

    it("drops banned words with look-alike letters, not Russian words", async () => {
      const s = settings((s) => {
        s.protection.banned = ["idiot", "bot"];
      });

      expect(await say("you іdiot", s)).toEqual([]);
      expect(await say("you ıdiot", s)).toEqual([]);
      expect(await say("you idіоt", s)).toEqual([]);
      expect(await say("вот так", s)).toHaveLength(1);
    });

    it("drops banned emojis, never matching an empty entry", async () => {
      const s = settings((s) => {
        s.protection.banned = ["🍆", "❤️", "", "\u0301"];
      });

      expect(await say("look 🍆", s)).toEqual([]);
      expect(await say("I ❤️ you", s)).toEqual([]);
      expect(await say("hello 🌸", s)).toHaveLength(1);
    });

    it("drops comments from names with banned words", async () => {
      const s = settings((s) => {
        s.protection.banned = ["slur"];
        s.format.template = "{comment}";
      });

      expect(
        await say(chat("hi", { ...viewer, username: "Slur Lord" }), s),
      ).toEqual([]);
      expect(
        await say(chat("hi", { ...viewer, handle: "the_slur" }), s),
      ).toEqual([]);
    });

    it("doesn't check the template's own words", async () => {
      const s = settings((s) => {
        s.protection.banned = ["says"];
        s.format.template = "{username} says {comment}";
      });

      expect(await say("hi", s)).toEqual(["Viewer says hi"]);
    });

    it("drops comments over the length limit", async () => {
      const s = settings((s) => {
        s.protection.comment_length = 5;
      });

      expect(await say("123456", s)).toEqual([]);
      expect(await say("12345", s)).toHaveLength(1);
    });

    it("checks the chat user's permissions", async () => {
      const s = settings((s) => {
        s.permissions.all = false;
        s.permissions.followers = true;
      });

      expect(await say(chat("hi"), s)).toEqual([]);
      expect(await say(chat("hi", { ...viewer, follower: true }), s)).toEqual([
        "hi",
      ]);
    });
  });

  describe("prepareText", () => {
    it("applies the replacements", () => {
      const s = settings((s) => {
        s.replacements = [{ old: "lol", new: "laughing" }];
      });

      expect(service.prepareText("Thanks lol", s)).toBe("Thanks laughing");
    });

    it("refuses empty text and text with banned words", () => {
      const s = settings((s) => {
        s.protection.banned = ["Spoiler"];
      });

      expect(service.prepareText("  ", s)).toBeNull();
      expect(service.prepareText("\u3164\u200B", s)).toBeNull();
      expect(service.prepareText("Thanks SPOILER fan", s)).toBeNull();
      expect(service.prepareText("Thanks fan", s)).toBe("Thanks fan");
    });

    it("refuses text of only punctuation", () => {
      expect(service.prepareText("?!...", settings())).toBeNull();
      expect(service.prepareText("1?", settings())).toBe("1?");
    });

    it("checks banned words only in the part given to check", () => {
      const s = settings((s) => {
        s.protection.banned = ["follow"];
      });

      expect(service.prepareText("Thanks for the follow", s, "Viewer")).toBe(
        "Thanks for the follow",
      );
      expect(
        service.prepareText("Thanks Follow Bot", s, "Follow Bot"),
      ).toBeNull();
    });

    it("removes the emojis when set, refusing text with nothing else", () => {
      const s = settings((s) => {
        s.format.remove_emojis = true;
      });

      expect(service.prepareText("Thanks 🌸 fan 🎉", s)).toBe("Thanks fan");
      expect(service.prepareText("🎉🎉", s)).toBeNull();
      expect(service.prepareText("🎉🎉", settings())).toBe("🎉🎉");
    });
  });

  describe("emojis", () => {
    const removing = (change: (s: TTSSettings) => void = () => {}) =>
      settings((s) => {
        s.format.remove_emojis = true;
        change(s);
      });

    it("reads them unless they're removed", async () => {
      expect(await say("hi 😂")).toEqual(["hi 😂"]);
      expect(await say("hi 😂 👍🏽", removing())).toEqual(["hi"]);
    });

    it("removes them from the name too, keeping the words apart", async () => {
      const s = removing((s) => {
        s.format.template = "{username} says {comment}";
      });
      const lucia = { ...viewer, username: "Lucía 🔥" };

      expect(await say(chat("I❤️you", lucia), s)).toEqual(["Lucía says I you"]);
    });

    it("skips comments of only emojis, without reading the name", async () => {
      const s = removing((s) => {
        s.format.template = "{username} {comment}";
      });

      expect(await say("😂😂😂", s)).toEqual([]);
    });

    it("applies the replacements first", async () => {
      const s = removing((s) => {
        s.replacements = [{ old: "❤️", new: "love" }];
      });

      expect(await say("I ❤️ you 😂", s)).toEqual(["I love you"]);
      expect(await say("❤️", s)).toEqual(["love"]);
    });
  });

  describe("text", () => {
    it("skips a message of only punctuation", async () => {
      expect(await say("?")).toEqual([]);
      expect(await say("...")).toEqual([]);
    });

    it("reads the name with a comment of only punctuation", async () => {
      const s = settings((s) => {
        s.format.template = "{username} {comment}";
      });

      expect(await say("?", s)).toEqual(["Viewer ?"]);
    });

    it("fills the template variables", async () => {
      const s = settings((s) => {
        s.format.template = "{username} ({handle}) says {comment}";
      });

      expect(await say("hello", s)).toEqual(["Viewer (viewer) says hello"]);
    });

    it("reads dollar signs in a comment as they are", async () => {
      const s = settings((s) => {
        s.format.template = "{username} says {comment}";
      });

      expect(await say("I paid $& and $$5", s)).toEqual([
        "Viewer says I paid $& and $$5",
      ]);
    });

    it("reads variables in a comment or a name as written", async () => {
      const s = settings((s) => {
        s.format.template = "{username} says {comment}";
      });
      const named = { ...viewer, username: "{comment}" };

      expect(await say("{handle}", s)).toEqual(["Viewer says {handle}"]);
      expect(await say(chat("hi", named), s)).toEqual(["{comment} says hi"]);
    });

    it("reads the comment when the template has no variables", async () => {
      const s = settings((s) => {
        s.format.template = "static text";
      });

      expect(await say("hello", s)).toEqual(["hello"]);
    });

    it("replaces whole words, ignoring case", async () => {
      const s = settings((s) => {
        s.replacements = [{ old: "lol", new: "laughing" }];
      });

      expect(await say("LOL that is lolly", s)).toEqual([
        "laughing that is lolly",
      ]);
    });

    it("treats regex characters in replacements literally", async () => {
      const s = settings((s) => {
        s.replacements = [{ old: "a.c", new: "x" }];
      });

      expect(await say("abc a.c", s)).toEqual(["abc x"]);
    });

    it("replaces words that start or end with symbols", async () => {
      const s = settings((s) => {
        s.replacements = [
          { old: ":)", new: "smile" },
          { old: "c++", new: "c plus plus" },
        ];
      });

      expect(await say("I like c++ :) hi:)", s)).toEqual([
        "I like c plus plus smile hismile",
      ]);
    });

    it("treats accented letters as part of a word", async () => {
      const s = settings((s) => {
        s.replacements = [{ old: "qué", new: "what" }];
      });

      expect(await say("qué quéso", s)).toEqual(["what quéso"]);
    });

    it("replaces words inside scripts written without spaces", async () => {
      const s = settings((s) => {
        s.replacements = [{ old: "草", new: "笑" }];
      });

      expect(await say("それは草", s)).toEqual(["それは笑"]);
    });

    it("inserts the new text literally and skips empty words", async () => {
      const s = settings((s) => {
        s.replacements = [
          { old: "", new: "!" },
          { old: "money", new: "$& $1" },
        ];
      });

      expect(await say("money", s)).toEqual(["$& $1"]);
    });
  });

  // onError logs it, once per notice
  it("skips a failed generation without logging it", async () => {
    vi.spyOn(service, "generateBuffer").mockResolvedValue({
      success: false,
      error: new Error("rate limited"),
    });
    const error = vi.spyOn(Logger, "error");

    expect(await say("hi")).toEqual([]);
    expect(error).not.toHaveBeenCalled();
  });

  it("calls onError when the generation fails", async () => {
    const error = new Error("rate limited");
    vi.spyOn(service, "generateBuffer").mockResolvedValue({
      success: false,
      error,
    });
    const onAudio = vi.fn();
    const onError = vi.fn();

    service.talk(chat("hi"), settings(), onAudio, onError);
    await new Promise((r) => setTimeout(r));

    expect(onAudio).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
  });

  it("clearTalk drops the waiting messages", async () => {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const s = settings((s) => {
      s.protection.cooldown = 1;
    });
    const spoken: string[] = [];
    const record = (res: { data?: Buffer }) =>
      spoken.push(res.data?.toString() ?? "");

    service.talk(chat("first"), s, record);
    service.talk(chat("second"), s, record);
    await vi.advanceTimersByTimeAsync(0);
    service.clearTalk();
    // Well past the 1 second gap the second message waited for
    await vi.advanceTimersByTimeAsync(5000);

    expect(spoken).toEqual(["first"]);
  });

  describe("waiting for the window", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    type Sent = { id: number; text: string }[];
    // What was sent to the window, which never plays it on its own
    const talkAll = (comments: string[], sent: Sent = [], s = settings()) => {
      for (const comment of comments) {
        service.talk(chat(comment), s, (res) =>
          sent.push({ id: res.id, text: res.data?.toString() ?? "" }),
        );
      }
      return sent;
    };
    const texts = (sent: { text: string }[]) => sent.map((m) => m.text);

    it("makes the third message once the window played one", async () => {
      const sent = talkAll(["one", "two", "three"]);
      await vi.advanceTimersByTimeAsync(1000);

      expect(texts(sent)).toEqual(["one", "two"]);

      service.played(sent[0].id);
      await vi.advanceTimersByTimeAsync(250);

      expect(texts(sent)).toEqual(["one", "two", "three"]);
    });

    it("holds one message with a queue length of 1", async () => {
      const one = settings((s) => {
        s.protection.queue_length = 1;
      });
      const sent = talkAll(["one"], [], one);
      await vi.advanceTimersByTimeAsync(0);
      talkAll(["two"], sent, one);
      await vi.advanceTimersByTimeAsync(1000);

      expect(texts(sent)).toEqual(["one"]);

      service.played(sent[0].id);
      await vi.advanceTimersByTimeAsync(250);

      expect(texts(sent)).toEqual(["one", "two"]);
    });

    it("stops waiting when cleared", async () => {
      const sent = talkAll(["one", "two", "three"]);
      await vi.advanceTimersByTimeAsync(1000);

      service.clearTalk();
      talkAll(["four"], sent);
      await vi.advanceTimersByTimeAsync(1000);

      expect(texts(sent)).toEqual(["one", "two", "four"]);
    });

    it("stops waiting when the window reloads", async () => {
      const sent = talkAll(["one", "two", "three"]);
      await vi.advanceTimersByTimeAsync(1000);

      service.releaseHeld();
      await vi.advanceTimersByTimeAsync(250);

      expect(texts(sent)).toEqual(["one", "two", "three"]);
    });

    it("gives up on the window after two minutes", async () => {
      const sent = talkAll(["one", "two", "three", "four"]);
      await vi.advanceTimersByTimeAsync(2 * 60_000 - 250);

      expect(texts(sent)).toEqual(["one", "two"]);

      await vi.advanceTimersByTimeAsync(250);

      expect(texts(sent)).toEqual(["one", "two", "three", "four"]);
    });

    it("gives up after two minutes even when the system clock changes", async () => {
      const sent = talkAll(["one", "two", "three"]);
      await vi.advanceTimersByTimeAsync(1000);
      vi.setSystemTime(Date.now() + 60 * 60_000);
      await vi.advanceTimersByTimeAsync(250);

      expect(texts(sent)).toEqual(["one", "two"]);

      vi.setSystemTime(Date.now() - 2 * 60 * 60_000);
      await vi.advanceTimersByTimeAsync(2 * 60_000);

      expect(texts(sent)).toEqual(["one", "two", "three"]);
    });

    it("gives every message a new id", async () => {
      const sent = talkAll(["one", "two"]);
      await vi.advanceTimersByTimeAsync(0);
      service.clearTalk();
      talkAll(["three"], sent);
      await vi.advanceTimersByTimeAsync(0);

      expect(sent.map((m) => m.id)).toEqual([1, 2, 3]);
    });
  });

  it("clearTalk drops the message being made", async () => {
    let release = () => {};
    vi.spyOn(service, "generateBuffer").mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ success: true, buffer: Buffer.from("hi") });
        }),
    );
    const callback = vi.fn();

    service.talk(chat("hi"), settings(), callback);
    await new Promise((r) => setTimeout(r));
    service.clearTalk();
    release();
    await new Promise((r) => setTimeout(r));

    expect(callback).not.toHaveBeenCalled();
  });
});
