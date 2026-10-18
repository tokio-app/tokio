import { UserData } from "@/common/types";
import { escapeRegExp } from "es-toolkit";

function getEmojiRegex() {
  let EMOJI_REGEX: RegExp;
  try {
    EMOJI_REGEX = new RegExp(
      String.raw`(?:\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?)*)|(?:[#*0-9]\uFE0F?\u20E3)|(?:\p{Regional_Indicator}{2})`,
      "gu",
    );
  } catch {
    EMOJI_REGEX =
      /(?:[\u{1F300}-\u{1FAFF}](?:\uFE0F|\uFE0E)?(?:\u200D[\u{1F300}-\u{1FAFF}](?:\uFE0F|\uFE0E)?)*)|(?:[#*0-9]\uFE0F?\u20E3)|(?:[\u{1F1E6}-\u{1F1FF}]{2})/gu;
  }

  return EMOJI_REGEX;
}

export function cleanText(
  input: string | undefined | null,
  opts: { collapseWhitespace?: boolean; asciiOnly?: boolean } = {},
): string {
  const { collapseWhitespace = true, asciiOnly = false } = opts;
  if (!input) return "";

  let out = input.replace(getEmojiRegex(), "");

  try {
    out = out.normalize("NFKC");
  } catch {
    // Next
  }

  if (asciiOnly) {
    try {
      out = out.normalize("NFKD").replace(/\p{M}+/gu, "");
    } catch {
      // Next
    }
  }

  const final = collapseWhitespace ? out.replace(/\s+/g, " ").trim() : out;
  return final.toLowerCase();
}

/**
 * Whether the chat has the keyword as a whole word or phrase, ignoring case,
 * accents and emojis. An empty keyword matches any chat.
 */
export function hasKeyword(content: string, keyword: string): boolean {
  const needle = cleanText(keyword, { asciiOnly: true });
  if (!needle) return true;

  // Letters and digits around it would make it part of another word.
  const pattern = new RegExp(
    String.raw`(?<![\p{L}\p{N}])${escapeRegExp(needle)}(?![\p{L}\p{N}])`,
    "u",
  );
  return pattern.test(cleanText(content, { asciiOnly: true }));
}

/**
 * Whether the viewer is the one named: by handle, with or without the @, or
 * by name, ignoring case, accents and emojis. An empty name means anyone.
 */
export function isUser(user: UserData, name: string): boolean {
  const wanted = name.trim();
  if (!wanted) return true;

  if (user.handle.toLowerCase() === wanted.replace(/^@/, "").toLowerCase()) {
    return true;
  }
  const username = cleanText(user.username, { asciiOnly: true });
  return username !== "" && username === cleanText(wanted, { asciiOnly: true });
}
