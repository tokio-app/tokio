import { describe, expect, it } from "vitest";
import { hasKeyword, isUser } from "./chat";

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

  it("takes symbols in the keyword literally", () => {
    expect(hasKeyword("!sound please", "!sound")).toBe(true);
    expect(hasKeyword("a+b", "a+b")).toBe(true);
    expect(hasKeyword("aab", "a+b")).toBe(false);
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

  it("never matches a name that is only emojis", () => {
    expect(isUser({ ...user, username: "🔥🔥" }, "🔥🔥")).toBe(false);
  });
});
