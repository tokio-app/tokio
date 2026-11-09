import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

const INTRO =
  "Make your TikTok LIVE react to chat, gifts, likes and more: text-to-speech, music requests, sound alerts and overlays.";

/**
 * Release note sections in order. Each pull request goes to the first section
 * it matches; one that matches none (chores, docs, refactors, tests, CI) is
 * left out, since users don't notice it.
 *
 * @type {{ title: string, match: (pull: Pull) => boolean }[]}
 */
const SECTIONS = [
  { title: "Breaking Changes", match: (p) => p.breaking },
  { title: "New Features", match: (p) => p.type === "feat" },
  { title: "Fixes", match: (p) => p.type === "fix" },
  { title: "Performance", match: (p) => p.type === "perf" },
  { title: "Reverts", match: (p) => p.type === "revert" },
];

/**
 * @typedef {object} Pull
 * @property {number} number - The pull request's number.
 * @property {string} sha - Its first commit, whose author is credited.
 * @property {string} author - That commit's author's name.
 * @property {string} email - That commit's author's email.
 * @property {string | null} type - The Conventional Commits type of its title, or null if the title doesn't follow it.
 * @property {string | null} scope - The Conventional Commits scope.
 * @property {boolean} breaking - Whether the title marks a breaking change.
 * @property {string} title - The title without type and scope, capitalized.
 */

/**
 * The section of the notes a pull request goes in.
 *
 * @param {Pull} pull - The pull request.
 * @returns {string | undefined} The section's title, or undefined when it's left out.
 */
export function sectionOf(pull) {
  return SECTIONS.find((section) => section.match(pull))?.title;
}

/**
 * Runs git in the repository root and returns its output.
 *
 * @param {string[]} args - The git arguments.
 * @returns {string} The command's stdout.
 */
function git(args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * Finds the latest v* tag reachable from a ref.
 *
 * @param {string} ref - Where to start looking, e.g. `v1.0.0^` or `HEAD`.
 * @returns {string | null} The tag, or null if there is none.
 */
export function previousTag(ref) {
  try {
    return git([
      "describe",
      "--tags",
      "--abbrev=0",
      "--match",
      "v*",
      ref,
    ]).trim();
  } catch {
    return null;
  }
}

/**
 * Parses a commit message as a Conventional Commit.
 *
 * @param {string} message - The full commit message, or a pull request's title.
 * @returns {Pick<Pull, "type" | "scope" | "breaking" | "title">} The parsed message.
 */
export function parseCommit(message) {
  const subject = message.split("\n", 1)[0].trim();
  const match = subject.match(/^(\w+)(?:\(([^)]+)\))?(!)?: (.+)$/);
  const text = match ? match[4] : subject;

  return {
    type: match ? match[1].toLowerCase() : null,
    scope: match?.[2] ?? null,
    breaking: !!match?.[3] || /^BREAKING[ -]CHANGE:/m.test(message),
    title: text.charAt(0).toUpperCase() + text.slice(1),
  };
}

/**
 * Reads a pull request's number and title from the commit GitHub made to merge
 * it: "Merge pull request #12 from owner/branch", then the title.
 *
 * @param {string} message - The full commit message.
 * @returns {{ number: number, title: string } | null} The pull request, or null for any other commit.
 */
export function parsePull(message) {
  const match = message.match(
    /^Merge pull request #(\d+) from (\S+)(?:\n\n(.+))?/,
  );
  if (!match) return null;
  // GitHub writes the title, unless the merge was given an empty message
  return { number: Number(match[1]), title: (match[3] ?? match[2]).trim() };
}

/**
 * Reads the pull requests merged in a range, newest first. Commits pushed or
 * merged without a pull request are left out.
 *
 * @param {string | null} from - The exclusive start, or null for the whole history.
 * @param {string} to - The inclusive end.
 * @returns {Pull[]} The pull requests.
 */
export function readPulls(from, to) {
  const range = from ? `${from}..${to}` : to;
  // On the first-parent line: what was merged into main, not into the branches
  const log = git([
    "log",
    "--merges",
    "--first-parent",
    "--format=%P%x1f%B%x1e",
    range,
  ]);

  return log
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .flatMap((record) => {
      const [parents, message] = record.split("\x1f");
      const pull = parsePull(message);
      if (!pull) return [];

      // Its first commit, made by whoever opened it
      const [base, head] = parents.split(" ");
      const [first] = git([
        "log",
        "--reverse",
        "--format=%H%x1f%an%x1f%ae",
        `${base}..${head}`,
      ]).split("\n");
      const [sha, author, email] = first.split("\x1f");
      return [
        { number: pull.number, sha, author, email, ...parseCommit(pull.title) },
      ];
    });
}

/**
 * Looks up the GitHub account that authored a commit.
 *
 * @param {string} repo - The repository, as owner/name.
 * @param {string} sha - The commit hash.
 * @param {string} [token] - A GitHub token, to avoid the anonymous rate limit.
 * @returns {Promise<string | null>} The login, or null if it can't be found.
 */
export async function githubLogin(repo, sha, token) {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/commits/${sha}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.author?.login ?? null;
  } catch {
    return null;
  }
}

/**
 * Renders the release notes as Markdown.
 *
 * @param {object} options
 * @param {string} options.repo - The repository, as owner/name.
 * @param {string | null} options.from - The previous tag, or null for the first release.
 * @param {string} options.to - The released tag or ref.
 * @param {Pull[]} options.pulls - The pull requests merged for the release, newest first.
 * @param {Map<string, string | null>} options.logins - GitHub logins by author email.
 * @returns {string} The notes.
 */
export function renderNotes({ repo, from, to, pulls, logins }) {
  const url = `https://github.com/${repo}`;
  const lines = ["## Tokio", "", INTRO, "", "## What's Changed", ""];

  /** @type {Map<string, Pull[]>} */
  const groups = new Map(SECTIONS.map((section) => [section.title, []]));
  for (const pull of pulls) groups.get(sectionOf(pull))?.push(pull);

  for (const [title, items] of groups) {
    if (items.length === 0) continue;

    lines.push(`## ${title}`, "");
    for (const pull of items) {
      const login = logins.get(pull.email);
      const author = login
        ? `[${pull.author}](https://github.com/${login})`
        : pull.author;
      lines.push(
        `- [ [#${pull.number}](${url}/pull/${pull.number}) ] - **${pull.title}** _by_ ${author}`,
      );
    }
    lines.push("");
  }

  if (!pulls.some(sectionOf)) lines.push("No changes.", "");

  const changelog = from
    ? `[\`${from}...${to}\`](${url}/compare/${from}...${to})`
    : `[\`${to}\`](${url}/commits/${to})`;
  lines.push("---", "", `**Full Changelog**: ${changelog}`, "");

  return lines.join("\n");
}
