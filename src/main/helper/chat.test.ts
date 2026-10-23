import { describe, expect, it } from "vitest";
import { hasKeyword, isBlank, isUser, removeEmojis, sameHandle } from "./chat";

describe("removeEmojis", () => {
  it.each([
    ["skin tones", "👍🏽"],
    ["ZWJ sequences", "👩🏽‍💻👨‍👩‍👧‍👦"],
    ["emoji and text styles", "❤\uFE0F❤\uFE0E"],
    ["flags", "🇺🇸🇲🇽🏳️‍🌈"],
    // England's, whose letters are tags
    [
      "tag flags",
      "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}",
    ],
    ["keycaps", "1️⃣#️⃣"],
  ])("removes %s whole", (_, emojis) => {
    expect(removeEmojis(`hi ${emojis}!`)).toBe("hi !");
  });

  it("leaves text alone", () => {
    // Devanagari joins some letters with a ZWJ
    const text = "C# #1 *bold* 1+1=2 ¿qué? 日本語 क्\u200Dष";

    expect(removeEmojis(text)).toBe(text);
  });

  it("replaces each emoji with the text given", () => {
    expect(removeEmojis("I❤️you", " ")).toBe("I you");
  });
});

describe("isBlank", () => {
  it.each([
    ["nothing", ""],
    ["spaces", " \t\n"],
    ["zero-width characters", "\u200B\u200C\u200D\u2060\uFEFF"],
    ["bidi marks", "\u200E\u202E"],
    ["Hangul fillers", "\u115F\u1160\u3164\uFFA0"],
    ["the empty Braille pattern", "\u2800 \u2800"],
  ])("is true for %s", (_, text) => {
    expect(isBlank(text)).toBe(true);
  });

  it("is false for text with something to read", () => {
    expect(isBlank("\u200Bhi")).toBe(false);
    expect(isBlank("🎉")).toBe(false);
    expect(isBlank("\u2801")).toBe(false);
  });
});

describe("hasKeyword", () => {
  it("matches any chat without a keyword", () => {
    expect(hasKeyword("hello", "")).toBe(true);
    expect(hasKeyword("hello", "   ")).toBe(true);
  });

  it("matches whole words and phrases", () => {
    expect(hasKeyword("hi there", "hi")).toBe(true);
    expect(hasKeyword("well, good morning!", "good morning")).toBe(true);
    expect(hasKeyword("this", "hi")).toBe(false);
    expect(hasKeyword("casi", "si")).toBe(false);
  });

  it("ignores case, accents, extra spaces and emojis", () => {
    expect(hasKeyword("HI!", "hi")).toBe(true);
    expect(hasKeyword("pon una canción", "Cancion")).toBe(true);
    expect(hasKeyword("good   morning", "good morning")).toBe(true);
    expect(hasKeyword("🔥hi🔥", "hi")).toBe(true);
  });

  it("looks for a keyword of only emojis as written", () => {
    expect(hasKeyword("a 🌹 for you", "🌹")).toBe(true);
    expect(hasKeyword("hello", "🌹")).toBe(false);
    expect(hasKeyword("hello 🔥", " 🌹 ")).toBe(false);
  });

  it("takes symbols in the keyword literally", () => {
    expect(hasKeyword("!sound please", "!sound")).toBe(true);
    expect(hasKeyword("a+b", "a+b")).toBe(true);
    expect(hasKeyword("aab", "a+b")).toBe(false);
  });

  it("finds keywords inside scripts written without spaces", () => {
    expect(hasKeyword("誕生日おめでとう", "おめでとう")).toBe(true);
    expect(hasKeyword("主播加油啊", "加油")).toBe(true);
    expect(hasKeyword("ขอบคุณมากครับ", "ขอบคุณ")).toBe(true);
    expect(hasKeyword("日本語hello", "hello")).toBe(true);
    expect(hasKeyword("concat", "cat")).toBe(false);
    expect(hasKeyword("snake_case", "case")).toBe(false);
  });
});

describe("sameHandle", () => {
  it("ignores the @, case and the spaces around", () => {
    expect(sameHandle("@Viewer", "viewer")).toBe(true);
    expect(sameHandle(" viewer ", "@VIEWER")).toBe(true);
    expect(sameHandle("viewer", "viewer2")).toBe(false);
  });

  it("never matches an empty handle", () => {
    expect(sameHandle("", "")).toBe(false);
    expect(sameHandle("@", "")).toBe(false);
  });
});

describe("isUser", () => {
  const user = {
    username: "Lucía 🔥",
    handle: "lucia_streams",
    profilePictures: [],
  };

  it("matches anyone without a name", () => {
    expect(isUser(user, "")).toBe(true);
    expect(isUser(user, "  ")).toBe(true);
  });

  it("matches the handle with or without the @, ignoring case", () => {
    expect(isUser(user, "lucia_streams")).toBe(true);
    expect(isUser(user, "@Lucia_Streams")).toBe(true);
    expect(isUser(user, "@lucia_stream")).toBe(false);
  });

  it("matches the name, ignoring case, accents and emojis", () => {
    expect(isUser(user, "lucia")).toBe(true);
    expect(isUser(user, "LUCÍA ")).toBe(true);
    expect(isUser(user, "luc")).toBe(false);
  });

  it("ignores the skin tones of emojis in the name", () => {
    expect(isUser({ ...user, username: "Ana 👋🏽" }, "ana")).toBe(true);
  });

  it("never matches a name that is only emojis", () => {
    expect(isUser({ ...user, username: "🔥🔥" }, "🔥🔥")).toBe(false);
  });
});
