import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  githubLogin,
  previousTag,
  readPulls,
  renderNotes,
  sectionOf,
} from "./util.js";

// Prints the release notes for a tag, or for the next release (HEAD) without one:
// the pull requests merged since the previous tag.
// Usage: node scripts/release-notes/index.js [tag]
const tag = process.argv[2];
const to = tag ?? "HEAD";
const from = previousTag(tag ? `${tag}^` : "HEAD");

const pkg = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../package.json"), "utf8"),
);
const repo =
  process.env.GITHUB_REPOSITORY ??
  pkg.repository.url.match(/github\.com[/:](.+?)(?:\.git)?$/)[1];
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

const pulls = readPulls(from, to);

/** @type {Map<string, string | null>} */
const logins = new Map();
for (const pull of pulls) {
  if (!logins.has(pull.email)) {
    logins.set(pull.email, await githubLogin(repo, pull.sha, token));
  }
}

process.stdout.write(renderNotes({ repo, from, to, pulls, logins }));

// On stderr, so the release workflow's notes file doesn't get them: a feature
// with a wrong title would be missed otherwise
for (const pull of pulls.filter((pull) => !sectionOf(pull))) {
  console.error(
    `Left out: #${pull.number} ${pull.title} (${pull.type ?? "no type"})`,
  );
}
