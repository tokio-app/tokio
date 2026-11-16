import { describe, expect, it } from "vitest";
import { getRemoteURL } from "./server";

describe("getRemoteURL", () => {
  it("puts the key in the fragment, encoded", () => {
    expect(getRemoteURL("192.168.1.20", "a+b/c=")).toBe(
      "http://192.168.1.20:37891/remote/#key=a%2Bb%2Fc%3D",
    );
  });
});
