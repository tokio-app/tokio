import { describe, expect, it, vi } from "vitest";
import { githubLogin, parseCommit, renderNotes } from "./util.js";

const repo = "tokio-app/tokio";

/** @param {Partial<import("./util.js").Commit>} overrides */
const commit = (overrides = {}) => ({
  sha: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
  short: "a1b2c3d",
  author: "Ana",
  email: "ana@example.com",
  type: "feat",
  scope: null,
  breaking: false,
  title: "Add alerts",
  ...overrides,
});

const render = (commits = [commit()], logins = new Map(), from = "v1.0.0") =>
  renderNotes({ repo, from, to: "v1.1.0", commits, logins });

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

describe("renderNotes", () => {
  it("groups the commits by section, in order", () => {
    const notes = render([
      commit({ type: "chore", title: "Bump" }),
      commit({ type: "fix", title: "Fix" }),
      commit({ type: "feat", title: "Feature" }),
      commit({ type: "feat", breaking: true, title: "Breaking" }),
      commit({ type: "perf", title: "Faster" }),
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
      "## Other Changes",
      "**Bump**",
    ].map((text) => notes.indexOf(text));
    expect(order.every((at, i) => at > (order[i - 1] ?? -1))).toBe(true);
    // A breaking feature is listed once, as breaking
    expect(notes.match(/\*\*Breaking\*\*/g)).toHaveLength(1);
  });

  it("links each commit and its author's GitHub account", () => {
    const notes = render(
      [commit(), commit({ author: "Bo", email: "bo@example.com" })],
      new Map([
        ["ana@example.com", "ana-gh"],
        ["bo@example.com", null],
      ]),
    );

    expect(notes).toContain(
      `- [ [\`a1b2c3d\`](https://github.com/${repo}/commit/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2) ] - **Add alerts** _by_ [Ana](https://github.com/ana-gh)`,
    );
    expect(notes).toContain("**Add alerts** _by_ Bo");
  });

  it("leaves out empty sections and says when nothing changed", () => {
    expect(render([commit({ type: "fix" })])).not.toContain("## New Features");
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
