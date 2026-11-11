import { REPOSITORY_URL } from "@/common/util";
import { describe, expect, it } from "vitest";
import { resolveNoticeLink, updateDetail, updateText } from "./helper";

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
      updateText(
        { state: "available", version: "1.2.0", manual: true, url: "" },
        "en",
      ),
    ).toBe("Tokio 1.2.0 is available.");
    expect(
      updateText({ state: "downloading", version: "1.2.0", percent: 40 }, "en"),
    ).toBe("Downloading Tokio 1.2.0…");
    expect(updateText({ state: "ready", version: "1.2.0" }, "en")).toBe(
      "Tokio 1.2.0 is ready to install.",
    );
  });
});

describe("updateDetail", () => {
  it("says what comes next", () => {
    expect(
      updateDetail(
        { state: "downloading", version: "1.2.0", percent: 40 },
        "en",
      ),
    ).toBe("You can keep using Tokio while it downloads.");
    expect(updateDetail({ state: "ready", version: "1.2.0" }, "en")).toBe(
      "It also installs when you quit Tokio.",
    );
    expect(updateDetail({ state: "idle" }, "en")).toBeUndefined();
    expect(updateDetail({ state: "checking" }, "en")).toBeUndefined();
  });

  it("says when Tokio last checked", () => {
    const checkedAt = new Date(2026, 10, 11, 14, 5).getTime();

    // Intl puts a narrow no-break space before PM
    expect(updateDetail({ state: "none", checkedAt }, "en")).toMatch(
      /^Last checked at 2:05\sPM$/,
    );
  });

  it("points to the release page when the app can't install it", () => {
    const available = {
      state: "available",
      version: "1.2.0",
      url: "",
    } as const;
    expect(updateDetail({ ...available, manual: false }, "en")).toBeUndefined();
    expect(updateDetail({ ...available, manual: true }, "en")).toBe(
      "Download it from the release page.",
    );
  });
});
