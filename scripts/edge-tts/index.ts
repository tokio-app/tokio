// Live check of the Edge TTS provider against Microsoft's service.
// Usage: yarn tts:edge:check [--chromium <full version>] [--token <v>[,<v>]] [--voice <ShortName>] [--text <text>] [--out <file.mp3>]
import { writeFileSync } from "fs";
import { parseArgs } from "util";
import {
  EdgeTTS,
  EdgeTTSError,
  edgeShortName,
} from "../../src/main/services/tts/providers/edge";
import type { TokenVersion } from "../../src/main/services/tts/providers/edge/types";

const { values } = parseArgs({
  options: {
    chromium: { type: "string" },
    token: { type: "string" },
    voice: { type: "string", default: "es-MX-JorgeNeural" },
    text: {
      type: "string",
      default: "Hola, ¿qué tal? Esta es una prueba de voz.",
    },
    out: { type: "string" },
  },
});

const isTokenVersion = (v: string): v is TokenVersion => v === "1" || v === "2";
const tokenVersions = values.token?.split(",");
if (tokenVersions && !tokenVersions.every(isTokenVersion)) {
  console.log(
    `Unknown token version in "${values.token}", expected 1 and/or 2`,
  );
  process.exit(1);
}

const tts = new EdgeTTS({
  ...(values.chromium && { CHROMIUM_FULL_VERSION: values.chromium }),
  ...(tokenVersions && { TOKEN_VERSIONS: tokenVersions }),
});

function report(stage: string, error: unknown) {
  console.log(`FAIL  ${stage}`);
  if (error instanceof EdgeTTSError) {
    console.log(`      ${error.message}`);
    if (error.cause instanceof Error) {
      console.log(`      cause: ${error.cause.message}`);
    }
  } else {
    console.log(`      ${String(error)}`);
  }
}

function isMp3(buffer: Buffer) {
  const id3 = buffer.subarray(0, 3).toString("ascii") === "ID3";
  const sync = buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
  return id3 || sync;
}

async function main() {
  const cfg = tts.config;
  console.log(
    `Chromium ${cfg.CHROMIUM_FULL_VERSION}, token versions [${cfg.TOKEN_VERSIONS.join(", ")}]`,
  );
  let failed = false;

  // Locales can have more than two parts (e.g. zh-CN-liaoning), prefer the voice list.
  let lang = values.voice.split("-").slice(0, 2).join("-");
  let name = values.voice.split("-").slice(2).join("-");

  try {
    const voices = await tts.getVoices();
    const spanish = voices.filter((v) => v.lang.startsWith("es-")).length;
    console.log(`PASS  voices     ${voices.length} voices, ${spanish} Spanish`);
    const match = voices.find((v) => edgeShortName(v) === values.voice);
    if (match) {
      ({ lang, name } = match);
    } else {
      ({ lang, name } = cfg.DEFAULT_VOICE);
      console.log(
        `WARN  voice "${values.voice}" is not in the list, the provider falls back to ${edgeShortName({ lang, name })}`,
      );
    }
  } catch (error) {
    report("voices", error);
    failed = true;
  }

  const res = await tts.generateBuffer(values.text, lang, name);
  if (res.success && res.buffer) {
    const ok = isMp3(res.buffer);
    console.log(
      `${ok ? "PASS" : "FAIL"}  synthesis  ${res.buffer.length} bytes${ok ? " of MP3" : ", not MP3"} (${lang} - ${name}, ${edgeShortName({ lang, name })})`,
    );
    if (values.out) writeFileSync(values.out, res.buffer);
    failed ||= !ok;
  } else {
    report("synthesis", res.error);
    failed = true;
  }

  process.exitCode = failed ? 1 : 0;
}

void main();
