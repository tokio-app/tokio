import { afterAll, describe, expect, it } from "vitest";
import config from "../config";
import { SapiHost } from "./host";

// The real script in PowerShell, which host.test.ts mocks away. Machines like
// CI's may have few voices, so no voice in particular is needed.
describe.runIf(process.platform === "win32")("the SAPI script", () => {
  // A CI runner busy with the other test files can take longer than the app
  // allows to load PowerShell and the speech engines. Only this file's copy of
  // the config changes.
  config.START_TIMEOUT_MS = 90_000;
  const host = new SapiHost();

  afterAll(() => host.dispose());

  it(
    "lists the voices and speaks PowerShell's special characters as text",
    async () => {
      const voices = await host.request({ type: "voices" });
      expect(Array.isArray(voices)).toBe(true);
      for (const voice of voices) {
        expect(voice).toEqual({
          name: expect.any(String),
          lang: expect.any(String),
          engine: expect.stringMatching(/^(sapi|onecore)$/),
        });
      }

      // Audio, or the script's own error without a voice to speak with
      const spoken = await host
        .request({
          type: "speak",
          text: "a`b'c\"d $(x)",
          rate: config.DEFAULT_RATE,
          volume: config.DEFAULT_VOLUME,
        })
        .then(
          (audio) => Buffer.from(audio, "base64").subarray(0, 4).toString(),
          (error: Error) => error.message,
        );
      if (voices.some((voice) => voice.engine === "sapi")) {
        expect(spoken).toBe("RIFF");
      } else {
        expect(spoken).not.toMatch(/timed out|exited/);
      }

      // Still running
      await expect(host.request({ type: "voices" })).resolves.toEqual(voices);
    },
    config.START_TIMEOUT_MS + 2 * config.REQUEST_TIMEOUT_MS + 5000,
  );
});
