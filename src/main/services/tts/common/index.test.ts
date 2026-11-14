import { describe, expect, it } from "vitest";
import { failureKey, TTSRequestError } from "./index";

const failed = (status?: number, code = "x") =>
  new TTSRequestError("ElevenLabs", code, "failed", status);

describe("failureKey", () => {
  it.each([
    [401, "main.tts.keyRejected"],
    [402, "main.tts.noCredits"],
    [403, "main.tts.notAllowed"],
    [404, "main.tts.voiceGone"],
    [429, "main.tts.busy"],
  ])("names why a %i failed", (status, key) => {
    expect(failureKey(failed(status))).toBe(key);
    expect(failureKey(failed(status), { cloning: true })).toBe(key);
  });

  it("says the key is missing", () => {
    expect(failureKey(failed(undefined, "missing_api_key"))).toBe(
      "main.tts.keyMissing",
    );
  });

  it("says the credits ran out by the code, whatever the status", () => {
    expect(failureKey(failed(401, "quota_exceeded"))).toBe(
      "main.tts.noCredits",
    );
    expect(failureKey(failed(400, "insufficient_credits"))).toBe(
      "main.tts.noCredits",
    );
  });

  it("says the key lacks a permission, whatever the status", () => {
    expect(failureKey(failed(401, "missing_permissions"))).toBe(
      "main.tts.keyPermissions",
    );
    expect(failureKey(failed(403, "insufficient_permissions"))).toBe(
      "main.tts.keyPermissions",
    );
  });

  it("says the plan can't do it by the code, whatever the status", () => {
    expect(failureKey(failed(402, "plan_required"), { cloning: true })).toBe(
      "main.tts.notAllowed",
    );
  });

  it("blames the samples for a 400 or 422 only when cloning", () => {
    for (const status of [400, 422]) {
      expect(failureKey(failed(status), { cloning: true })).toBe(
        "main.tts.badSamples",
      );
      expect(failureKey(failed(status))).toBeNull();
    }
  });

  it("leaves other failures to the caller's message", () => {
    expect(failureKey(failed(500))).toBeNull();
    expect(failureKey(failed(undefined, "network"))).toBeNull();
    expect(failureKey(new Error("HTTP 402"))).toBeNull();
    expect(failureKey(undefined)).toBeNull();
  });
});
