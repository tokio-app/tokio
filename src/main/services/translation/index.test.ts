import { ChatEvent, UserData } from "@/common/types";
import { formatError } from "@/common/util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TranslationError } from "./common";
import {
  CACHE_SIZE,
  ChatCommands,
  MAX_WAIT_MS,
  PAUSE_MS,
  RATE_BURST,
  TranslationService,
} from "./index";

const viewer: UserData = {
  username: "Viewer",
  handle: "viewer",
  profilePictures: [],
};

const chat = (content: string, lang = "en"): ChatEvent => ({
  user: viewer,
  comment: { content, emotes: [], lang },
});

const none: ChatCommands = { trigger: "", commands: [], keywords: [] };

const GOOGLE = "https://translate.googleapis.com/translate_a/single";

type Reply = { text: string; from?: string } | Response;

// Answers Google with what the reply function gives for the text
const stub = (
  google: (text: string, tl: string) => Reply = (text) => ({
    text: `es:${text}`,
  }),
) => {
  const fetch = vi.fn(async (url: string) => {
    const query = new URL(url).searchParams;
    const reply = google(query.get("q")!, query.get("tl")!);
    if (reply instanceof Response) return reply;
    return Response.json([
      [[reply.text, query.get("q"), null, null]],
      null,
      reply.from ?? "en",
    ]);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
};

const queries = (fetch: ReturnType<typeof stub>) =>
  fetch.mock.calls.map(([url]) => new URL(url).searchParams.get("q"));

const failure = (status: number) => Response.json({}, { status });

describe("TranslationService", () => {
  let service: TranslationService;

  beforeEach(() => {
    service = new TranslationService();
    service.setLanguage("es");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const translated = async (
    content: string,
    { lang = "en", commands = none } = {},
  ) => (await service.forChat(chat(content, lang), () => commands))?.comment;

  describe("forChat", () => {
    it("gives null at once, with no request and no commands read", () => {
      const fetch = stub();
      const commands = vi.fn(() => none);
      const check = (content: string, lang = "en") =>
        expect(service.forChat(chat(content, lang), commands)).toBeNull();

      // Not tagged, the target's own base language, or no letter
      check("hola", "");
      check("hola", "es");
      check("hola", "ES-419");
      check("🔥🔥 123");
      service.setLanguage("");
      check("hello");
      // A language outside the list turns it off
      service.setLanguage("xx");
      check("hello");

      expect(fetch).not.toHaveBeenCalled();
      expect(commands).not.toHaveBeenCalled();
    });

    it("translates a chat in another language", async () => {
      const fetch = stub((text, tl) => ({
        text: tl === "es" ? "hola amigos" : text,
      }));

      expect(await translated("hello friends")).toEqual({
        content: "hello friends",
        emotes: [],
        lang: "en",
        translation: { text: "hola amigos", from: "en", to: "es" },
      });
      expect(new URL(fetch.mock.calls[0][0]).toString()).toBe(
        `${GOOGLE}?client=gtx&sl=auto&tl=es&dt=t&q=hello+friends`,
      );
    });

    it("leaves commands and chat triggers' keywords as typed, with no request", async () => {
      const fetch = stub();
      const commands: ChatCommands = {
        trigger: "",
        commands: ["!play", "!socials"],
        keywords: ["tnt"],
      };
      const typed = async (content: string) => {
        const message = chat(content);
        expect(await service.forChat(message, () => commands)).toBe(message);
      };

      await typed("!PLAY never gonna give you up");
      await typed("!socials");
      await typed("send a TNT please");

      expect(fetch).not.toHaveBeenCalled();
    });

    it("keeps the TTS trigger as typed and translates the rest", async () => {
      const fetch = stub();
      const commands = { ...none, trigger: "!tts" };

      expect(
        (await translated("!TTS hello there", { commands }))?.translation?.text,
      ).toBe("!TTS es:hello there");
      expect(queries(fetch)).toEqual(["hello there"]);
    });

    it("puts the mentions at the ends back around the translation", async () => {
      const fetch = stub();

      expect((await translated("@kenji hi @yui.c"))?.translation?.text).toBe(
        "@kenji es:hi @yui.c",
      );
      expect(queries(fetch)).toEqual(["hi"]);
    });

    it("swaps the mentions in the middle for stand-ins and back", async () => {
      const fetch = stub((text) => ({
        text: text.replace("thanks", "gracias"),
      }));

      expect(
        (await translated("thanks @kenji_1 and @yui for the gift"))?.translation
          ?.text,
      ).toBe("gracias @kenji_1 and @yui for the gift");
      expect(queries(fetch)).toEqual(["thanks <0> and <1> for the gift"]);
    });

    it("gives no translation when a stand-in got lost", async () => {
      stub(() => ({ text: "gracias por el regalo" }));

      expect(
        (await translated("thanks @kenji for the gift"))?.translation,
      ).toBeUndefined();
    });

    it("sends nothing when only mentions have letters", async () => {
      const fetch = stub();

      expect((await translated("@kenji 🔥"))?.translation).toBeUndefined();
      expect(fetch).not.toHaveBeenCalled();
    });

    it("gives no translation when Google read the target language", async () => {
      stub((text) => ({ text, from: "es" }));

      expect((await translated("hola"))?.translation).toBeUndefined();
    });

    it("translates a text once per language", async () => {
      const fetch = stub();

      await translated("hi");
      await translated("hi");
      service.setLanguage("de");
      await translated("hi");

      expect(queries(fetch)).toEqual(["hi", "hi"]);
    });

    it("drops the oldest translation past the cache's size", async () => {
      vi.useFakeTimers({ toFake: ["performance"] });
      const fetch = stub();
      // A second apart, so every one has its turn at once
      const spaced = (content: string) => {
        vi.advanceTimersByTime(1000);
        return translated(content);
      };

      for (let i = 0; i <= CACHE_SIZE; i++) await spaced(`hi ${i}`);
      await spaced(`hi ${CACHE_SIZE}`);
      await spaced("hi 0");

      expect(fetch).toHaveBeenCalledTimes(CACHE_SIZE + 2);
    });

    it("sends a burst at once, then one a second, and leaves as typed what would wait too long", async () => {
      vi.useFakeTimers({ toFake: ["performance", "setTimeout"] });
      const fetch = stub();
      const waiting = Math.floor(MAX_WAIT_MS / 1000);
      const results = Array.from({ length: RATE_BURST + waiting + 1 }, (_, i) =>
        service.forChat(chat(`hi ${i}`), () => none),
      );

      await vi.advanceTimersByTimeAsync(0);
      expect(fetch).toHaveBeenCalledTimes(RATE_BURST);
      for (let n = 1; n <= waiting; n++) {
        await vi.advanceTimersByTimeAsync(1000);
        expect(fetch).toHaveBeenCalledTimes(RATE_BURST + n);
      }
      // The last had no turn soon enough: as typed, no request, no failure
      const last = await results.at(-1);
      expect(last?.comment.translation).toBeUndefined();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(fetch).toHaveBeenCalledTimes(RATE_BURST + waiting);
      expect((await results[RATE_BURST])?.comment.translation?.text).toBe(
        `es:hi ${RATE_BURST}`,
      );
    });

    it("refills a turn a second, and spends none on a cached text", async () => {
      vi.useFakeTimers({ toFake: ["performance", "setTimeout"] });
      const fetch = stub();
      const burst = (from: number) =>
        Array.from({ length: RATE_BURST }, (_, i) =>
          Promise.resolve(service.forChat(chat(`hi ${from + i}`), () => none)),
        );

      await Promise.all(burst(0));
      // Cached: no turn spent
      await Promise.all(burst(0));
      vi.advanceTimersByTime(RATE_BURST * 1000);
      burst(RATE_BURST);
      await vi.advanceTimersByTimeAsync(0);

      expect(fetch).toHaveBeenCalledTimes(RATE_BURST * 2);
    });

    it("gives the chat as typed when Google fails, then pauses", async () => {
      vi.useFakeTimers({ toFake: ["performance"] });
      const onFailure = vi.fn();
      service.onFailure(onFailure);
      let down = true;
      const fetch = stub((text) =>
        down ? failure(500) : { text: `es:${text}` },
      );

      const message = chat("hello");
      expect(await service.forChat(message, () => none)).toBe(message);
      expect(onFailure).toHaveBeenCalledExactlyOnceWith(
        expect.any(TranslationError),
      );
      // Paused: at once, with no request
      expect(service.forChat(chat("hello"), () => none)).toBeNull();

      down = false;
      vi.advanceTimersByTime(PAUSE_MS);
      // The failure left the cache
      expect((await translated("hello"))?.translation?.text).toBe("es:hello");
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("gives the chat as typed when commands can't be read", async () => {
      stub();
      const message = chat("hello");

      expect(
        await service.forChat(message, () => Promise.reject(new Error("x"))),
      ).toBe(message);
    });
  });

  describe("code maps", () => {
    it("names languages as Google does, both ways", async () => {
      service.setLanguage("zh-Hans");
      const fetch = stub(() => ({ text: "x", from: "iw" }));

      expect((await translated("shalom", { lang: "he" }))?.translation).toEqual(
        { text: "x", from: "he", to: "zh-hans" },
      );
      expect(new URL(fetch.mock.calls[0][0]).searchParams.get("tl")).toBe(
        "zh-CN",
      );
    });

    it("refuses a reply of an unexpected shape", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ sentences: [] })),
      );
      const onFailure = vi.fn();
      service.onFailure(onFailure);

      expect((await translated("hello"))?.translation).toBeUndefined();
      expect(onFailure.mock.calls[0][0]).toMatchObject({
        code: "bad_response",
      });
    });
  });

  it("keeps the text out of its errors", async () => {
    const errors: Error[] = [];
    service.onFailure((error) => {
      if (error instanceof Error) errors.push(error);
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    await translated("my private words");

    expect(errors).toHaveLength(1);
    const [error] = errors;
    expect(error).toBeInstanceOf(TranslationError);
    const shown = `${formatError(error)} ${JSON.stringify(error)} ${error.stack}`;
    expect(shown).not.toContain("private");
    expect(error.cause).toBeUndefined();
    expect(formatError(error)).toBe("Google request failed: fetch failed");
  });

  describe("test", () => {
    it("tells a command, and a message already in the language", async () => {
      stub((text) => ({ text, from: "es" }));

      expect(
        await service.test("!play song", { ...none, commands: ["!play"] }),
      ).toEqual({ kind: "command" });
      expect(await service.test("hola", none)).toEqual({
        kind: "same",
        from: "es",
      });
    });

    it("ignores TikTok's language and the pause", async () => {
      vi.useFakeTimers({ toFake: ["performance"] });
      let down = true;
      stub((text) => (down ? failure(500) : { text: `es:${text}` }));
      await translated("hello");
      down = false;

      expect(await service.test("@kenji hello", none)).toEqual({
        kind: "translated",
        translation: { text: "@kenji es:hello", from: "en", to: "es" },
      });
    });

    it("throws Google's failure", async () => {
      stub(() => failure(429));

      await expect(service.test("hello", none)).rejects.toMatchObject({
        status: 429,
      });
    });
  });
});
