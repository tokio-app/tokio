import { Profile } from "@/common/schemas";
import { ChatEvent, UserData } from "@/common/types";
import { defaultProfile } from "@/common/util";
import Logger from "@/logger";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

  // Resolves with what was sent to the speakers, if anything.
  const say = async (comment: string | ChatEvent, s = settings()) => {
    const spoken: string[] = [];
    service.talk(
      typeof comment === "string" ? chat(comment) : comment,
      s,
      (res) => spoken.push(res.data?.toString() ?? ""),
    );
    await new Promise((r) => setTimeout(r));
    return spoken;
  };

  const engine = (name: string) => service["_providerPool"]!.get(name)!;

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

    it("needs the trigger prefix unless the mode is any", async () => {
      const s = settings((s) => {
        s.format.trigger = { mode: "custom", value: "!tts" };
      });

      expect(await say("hello", s)).toEqual([]);
      expect(await say("!tts hello", s)).toHaveLength(1);
    });

    it("drops comments with banned words, ignoring case", async () => {
      const s = settings((s) => {
        s.protection.banned = ["Spoiler"];
      });

      expect(await say("big SPOILERS ahead", s)).toEqual([]);
      expect(await say("no secrets", s)).toHaveLength(1);
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
      expect(service.prepareText("Thanks SPOILER fan", s)).toBeNull();
      expect(service.prepareText("Thanks fan", s)).toBe("Thanks fan");
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

  it("logs and skips a failed generation", async () => {
    vi.spyOn(service, "generateBuffer").mockResolvedValue({
      success: false,
      error: new Error("rate limited"),
    });
    const error = vi.spyOn(Logger, "error");

    expect(await say("hi")).toEqual([]);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("rate limited"),
      undefined,
      expect.objectContaining({ message: "rate limited" }),
    );
  });

  it("calls onError when the generation fails", async () => {
    vi.spyOn(Logger, "error");
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
    const s = settings((s) => {
      s.protection.cooldown = 1;
    });
    const spoken: string[] = [];
    const record = (res: { data?: Buffer }) =>
      spoken.push(res.data?.toString() ?? "");

    service.talk(chat("first"), s, record);
    service.talk(chat("second"), s, record);
    await new Promise((r) => setTimeout(r));
    service.clearTalk();
    await new Promise((r) => setTimeout(r, 1100));

    expect(spoken).toEqual(["first"]);
  });
});
