import { REPOSITORY_URL } from "@/common/util";
import { describe, expect, it } from "vitest";
import { resolveNoticeLink, updateText } from "./helper";

describe("resolveNoticeLink", () => {
  it("keeps web and mail links", () => {
    expect(resolveNoticeLink("https://www.electronjs.org")).toEqual({
      url: "https://www.electronjs.org",
    });
    expect(resolveNoticeLink("mailto:me@example.com")).toEqual({
      url: "mailto:me@example.com",
    });
  });

  it("opens Tokio's license and the license texts in the viewer", () => {
    expect(resolveNoticeLink("LICENSE")).toEqual({ doc: "tokio" });
    expect(resolveNoticeLink("LICENSES/LGPL-3.0.txt")).toEqual({
      doc: "LGPL-3.0",
    });
  });

  it("sends other repository files to GitHub", () => {
    expect(resolveNoticeLink("src/main/index.ts")).toEqual({
      url: `${REPOSITORY_URL}/blob/main/src/main/index.ts`,
    });
  });

  it("refuses links that leave the repository or aren't files", () => {
    expect(resolveNoticeLink("../secret.txt")).toBeNull();
    expect(resolveNoticeLink("docs/../../etc")).toBeNull();
    expect(resolveNoticeLink("javascript:alert(1)")).toBeNull();
    expect(resolveNoticeLink("#licenses")).toBeNull();
    expect(resolveNoticeLink("")).toBeNull();
  });
});

describe("updateText", () => {
  it("describes every update state", () => {
    expect(updateText({ state: "idle" }, "en")).toBe(
      "Tokio hasn't checked for updates yet.",
    );
    expect(updateText({ state: "unsupported" }, "en")).toBe(
      "Updates aren't available in this build.",
    );
    expect(updateText({ state: "checking" }, "en")).toBe(
      "Checking for updates…",
    );
    expect(updateText({ state: "none", checkedAt: 0 }, "en")).toBe(
      "Tokio is up to date.",
    );
    expect(
      updateText({ state: "downloading", version: "1.2.0", percent: 40 }, "en"),
    ).toBe("Downloading Tokio 1.2.0… 40%");
    expect(updateText({ state: "ready", version: "1.2.0" }, "en")).toBe(
      "Tokio 1.2.0 is ready to install.",
    );
  });

  it("points to the release page when the app can't install it", () => {
    const available = {
      state: "available",
      version: "1.2.0",
      url: "",
    } as const;
    expect(updateText({ ...available, manual: false }, "en")).toBe(
      "Tokio 1.2.0 is available.",
    );
    expect(updateText({ ...available, manual: true }, "en")).toBe(
      "Tokio 1.2.0 is available. Download it from the release page.",
    );
  });
});
