import { UserData } from "@/common/types";
import { escapeRegExp } from "es-toolkit";

// A pictograph or skin tone with what modifies it (skin tone, text or emoji
// style, the tags of flags like England's), joined to others by ZWJ.
const EMOJI_PART = String.raw`[\p{Extended_Pictographic}\p{Emoji_Modifier}][\p{Emoji_Modifier}\uFE0E\uFE0F\u{E0020}-\u{E007F}]*`;
// Those, keycaps and flags
const EMOJI_REGEX = new RegExp(
  String.raw`${EMOJI_PART}(?:\u200D${EMOJI_PART})*|[#*0-9]\uFE0F?\u20E3|\p{Regional_Indicator}+`,
  "gu",
);

/** The text without emojis, each one replaced with `by`. */
export function removeEmojis(text: string, by = ""): string {
  return text.replace(EMOJI_REGEX, by);
}

/**
 * The text in lower case, without emojis and with its spaces collapsed.
 * `asciiOnly` also drops accents and other marks.
 */
export function cleanText(
  input: string | undefined | null,
  { asciiOnly = false }: { asciiOnly?: boolean } = {},
): string {
  if (!input) return "";

  let out = removeEmojis(input).normalize("NFKC");
  if (asciiOnly) out = out.normalize("NFKD").replace(/\p{M}+/gu, "");

  return out.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Whether the chat has the keyword as a whole word or phrase, ignoring case,
 * accents and emojis. An empty keyword matches any chat, and one of only
 * emojis is looked for as written.
 */
export function hasKeyword(content: string, keyword: string): boolean {
  if (!keyword.trim()) return true;
  const needle = cleanText(keyword, { asciiOnly: true });
  if (!needle) return content.includes(keyword.trim());

  // Letters and digits around it would make it part of another word.
  const pattern = new RegExp(
    String.raw`(?<![\p{L}\p{N}])${escapeRegExp(needle)}(?![\p{L}\p{N}])`,
    "u",
  );
  return pattern.test(cleanText(content, { asciiOnly: true }));
}

const bareHandle = (handle: string) =>
  handle.trim().replace(/^@/, "").toLowerCase();

/**
 * Whether two handles are the same, with or without the @, ignoring case and
 * the spaces around them. An empty one matches none.
 */
export function sameHandle(a: string, b: string): boolean {
  const handle = bareHandle(a);
  return handle !== "" && handle === bareHandle(b);
}

/**
 * Whether the viewer is the one named: by handle, with or without the @, or
 * by name, ignoring case, accents and emojis. An empty name means anyone.
 */
export function isUser(user: UserData, name: string): boolean {
  const wanted = name.trim();
  if (!wanted) return true;

  if (sameHandle(wanted, user.handle)) return true;
  const username = cleanText(user.username, { asciiOnly: true });
  return username !== "" && username === cleanText(wanted, { asciiOnly: true });
}
