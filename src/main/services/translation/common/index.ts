import type { MessageKey } from "@/common/i18n";
import { formatError } from "@/common/util";

// What Google gave back: the text, and the language it read as a lowercase
// BCP 47 tag
export type Translated = { text: string; from: string };

/**
 * A failed request to Google: its HTTP status, or a code like `network`. It
 * never has a cause, so the chat's text, which the request's URL carries,
 * can't reach the logs.
 */
export class TranslationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "TranslationError";
  }
}

/** The text that says why Google failed. */
export const reasonKey = (error: unknown): MessageKey =>
  error instanceof TranslationError && error.status === 429
    ? "translation.reason.busy"
    : "translation.reason.failed";

/** The language without its script or region, lowercase: zh-Hans is zh. */
export const baseLanguage = (code: string) =>
  code.split(/[-_]/)[0].toLowerCase();

/** Google's code for a language Settings picked, where it has its own. */
export const codeFor = (language: string, codes: Record<string, string>) =>
  codes[language] ?? language;

/** Google's code as a lowercase BCP 47 tag, through its own codes. */
export const tagOf = (code: string, codes: Record<string, string>) => {
  const own = Object.entries(codes).find(
    ([, theirs]) => theirs.toLowerCase() === code.toLowerCase(),
  );
  return (own?.[0] ?? code).toLowerCase();
};

/**
 * Fetches the reply, turning any failure into a TranslationError without the
 * request.
 */
export async function request(
  url: string,
  init: RequestInit,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (error) {
    // oxlint-disable-next-line preserve-caught-error
    throw new TranslationError(
      "network",
      `Google request failed: ${formatError(error)}`,
    );
  }
  if (!res.ok) {
    throw new TranslationError(
      `http_${res.status}`,
      `Google request failed: HTTP ${res.status}`,
      res.status,
    );
  }
  try {
    return await res.json();
  } catch (error) {
    // oxlint-disable-next-line preserve-caught-error
    throw new TranslationError(
      "bad_response",
      `Google sent an unreadable response: ${formatError(error)}`,
      res.status,
    );
  }
}

// A reply that isn't the shape the endpoint gives
export const unexpected = () =>
  new TranslationError(
    "bad_response",
    "Google sent a response of an unexpected shape.",
  );
