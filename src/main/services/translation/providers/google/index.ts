import { z } from "zod";
import { codeFor, request, tagOf, Translated, unexpected } from "../../common";
import config from "./config";

// The translation in parts, each a string first, then the language it read
const ReplySchema = z.tuple(
  [z.array(z.tuple([z.string()], z.unknown())).min(1), z.unknown(), z.string()],
  z.unknown(),
);

/** The text in the language, by Google's free endpoint. */
export async function translateWithGoogle(
  text: string,
  language: string,
): Promise<Translated> {
  const query = new URLSearchParams({
    client: "gtx",
    sl: "auto",
    tl: codeFor(language, config.CODES),
    dt: "t",
    q: text,
  });
  const body = await request(`${config.API_URL}?${query}`, {
    signal: AbortSignal.timeout(config.REQUEST_TIMEOUT_MS),
  });
  const reply = ReplySchema.safeParse(body);
  if (!reply.success) throw unexpected();
  const [parts, , from] = reply.data;
  return {
    text: parts.map(([part]) => part).join(""),
    from: tagOf(from, config.CODES),
  };
}
