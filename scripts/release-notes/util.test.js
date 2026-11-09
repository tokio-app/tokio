import { describe, expect, it, vi } from "vitest";
import {
  githubLogin,
  parseCommit,
  parsePull,
  renderNotes,
  sectionOf,
} from "./util.js";

const repo = "tokio-app/tokio";

/** @param {Partial<import("./util.js").Pull>} overrides */
const pull = (overrides = {}) => ({
  number: 12,
  sha: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
  author: "Ana",
  email: "ana@example.com",
  type: "feat",
  scope: null,
  breaking: false,
  title: "Add alerts",
  ...overrides,
});

const render = (pulls = [pull()], logins = new Map(), from = "v1.0.0") =>
  renderNotes({ repo, from, to: "v1.1.0", pulls, logins });

describe("parseCommit", () => {
  it("reads the type, the scope and the title", () => {
    expect(parseCommit("fix(tts): keep the voice\n\nDetails.")).toEqual({
      type: "fix",
      scope: "tts",
      breaking: false,
      title: "Keep the voice",
    });
  });

  it("marks breaking changes from the ! or the footer", () => {
    expect(parseCommit("feat!: drop old profiles").breaking).toBe(true);
    expect(
      parseCommit("refactor: rename\n\nBREAKING CHANGE: new names").breaking,
    ).toBe(true);
    expect(parseCommit("feat: add\n\nNot a BREAKING CHANGE: x").breaking).toBe(
      false,
    );
  });

  it("keeps a subject that doesn't follow Conventional Commits", () => {
    expect(parseCommit("update readme")).toEqual({
      type: null,
      scope: null,
      breaking: false,
      title: "Update readme",
    });
  });

  it("lowercases the type", () => {
    expect(parseCommit("Feat: add").type).toBe("feat");
  });
});

describe("parsePull", () => {
  it("reads the number and the title GitHub writes when it merges", () => {
    expect(
      parsePull(
        "Merge pull request #35 from tokio-app/fix/audit-10\n\nfix: everything from the tenth code audit\n",
      ),
    ).toEqual({
      number: 35,
      title: "fix: everything from the tenth code audit",
    });
  });

  it("names a pull request merged with an empty message after its branch", () => {
    expect(
      parsePull("Merge pull request #7 from tokio-app/feat/fans\n"),
    ).toEqual({ number: 7, title: "tokio-app/feat/fans" });
  });

  it("leaves out commits that didn't merge a pull request", () => {
    expect(parsePull("Merge branch 'docs/morph-waits'\n")).toBeNull();
    expect(parsePull("fix(music): say when Spotify has no app")).toBeNull();
  });
});

describe("renderNotes", () => {
  it("groups the pull requests by section, in order", () => {
    const notes = render([
      pull({ type: "revert", title: "Undo" }),
      pull({ type: "fix", title: "Fix" }),
      pull({ type: "feat", title: "Feature" }),
      pull({ type: "feat", breaking: true, title: "Breaking" }),
      pull({ type: "perf", title: "Faster" }),
    ]);

    const order = [
      "## Breaking Changes",
      "**Breaking**",
      "## New Features",
      "**Feature**",
      "## Fixes",
      "**Fix**",
      "## Performance",
      "**Faster**",
      "## Reverts",
      "**Undo**",
    ].map((text) => notes.indexOf(text));
    expect(order.every((at, i) => at > (order[i - 1] ?? -1))).toBe(true);
    // A breaking feature is listed once, as breaking
    expect(notes.match(/\*\*Breaking\*\*/g)).toHaveLength(1);
  });

  it("leaves out pull requests users don't notice, unless they break something", () => {
    const quiet = [
      pull({ type: "chore", title: "Bump" }),
      pull({ type: "docs", title: "Describe" }),
      pull({ type: "refactor", title: "Tidy" }),
      pull({ type: null, title: "Untyped" }),
    ];
    for (const item of quiet) expect(sectionOf(item)).toBeUndefined();

    const notes = render([
      ...quiet,
      pull({ type: "refactor", breaking: true, title: "Rename" }),
    ]);
    expect(notes).not.toMatch(/Bump|Describe|Tidy|Untyped/);
    expect(notes).toContain("**Rename**");
    expect(render(quiet)).toContain("No changes.");
  });

  it("links each pull request and its author's GitHub account", () => {
    const notes = render(
      [pull(), pull({ number: 13, author: "Bo", email: "bo@example.com" })],
      new Map([
        ["ana@example.com", "ana-gh"],
        ["bo@example.com", null],
      ]),
    );

    expect(notes).toContain(
      `- [ [#12](https://github.com/${repo}/pull/12) ] - **Add alerts** _by_ [Ana](https://github.com/ana-gh)`,
    );
    expect(notes).toContain(
      `- [ [#13](https://github.com/${repo}/pull/13) ] - **Add alerts** _by_ Bo`,
    );
  });

  it("leaves out empty sections and says when nothing changed", () => {
    expect(render([pull({ type: "fix" })])).not.toContain("## New Features");
    expect(render([])).toContain("No changes.");
  });

  it("compares with the previous tag, or lists the commits of a first release", () => {
    expect(render()).toContain(
      `**Full Changelog**: [\`v1.0.0...v1.1.0\`](https://github.com/${repo}/compare/v1.0.0...v1.1.0)`,
    );
    expect(render([], new Map(), null)).toContain(
      `**Full Changelog**: [\`v1.1.0\`](https://github.com/${repo}/commits/v1.1.0)`,
    );
  });
});

describe("githubLogin", () => {
  const respond = (body, ok = true) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok, json: async () => body })),
    );

  it("finds the account that authored a commit, with the token if given", async () => {
    respond({ author: { login: "ana-gh" } });

    expect(await githubLogin(repo, "abc", "token")).toBe("ana-gh");
    expect(fetch).toHaveBeenCalledWith(
      `https://api.github.com/repos/${repo}/commits/abc`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer token",
        },
      },
    );
  });

  it("gives null when GitHub can't say", async () => {
    respond({ author: null });
    expect(await githubLogin(repo, "abc")).toBeNull();

    respond({}, false);
    expect(await githubLogin(repo, "abc")).toBeNull();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    expect(await githubLogin(repo, "abc")).toBeNull();
  });
});
