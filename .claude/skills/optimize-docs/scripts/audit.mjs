// Audits the agent docs (AGENTS.md, .claude/rules and the project's own skills)
// for the optimize-docs skill: their sizes against the last "docs: trim" commit,
// the rule sets that load the most text, and what a trim can break. See ../SKILL.md.
//
//   node .claude/skills/optimize-docs/scripts/audit.mjs [--from <ref>] [--strict] [--self-test]
//
// Run it from the repository root. Its failures: a rule glob that matches no file,
// a rule without `paths`, a rule or skill AGENTS.md doesn't list, a missing rule or
// skill that a doc or a comment names, a section link whose heading is gone, or a
// BOM, CR or zero-width character in a doc. With --strict it exits with 1 on one.
// The names the code doesn't have are only listed: most are external.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SELF = relative(".", fileURLToPath(import.meta.url)).replaceAll(
  "\\",
  "/",
);
// By code point: tools turn written escapes into the characters themselves.
const ODD = new Map([
  [0xfeff, "U+FEFF"],
  [0x200b, "U+200B"],
  [0x200c, "U+200C"],
  [0x200d, "U+200D"],
  [0x2060, "U+2060"],
  [13, "CR"],
]);
const ALIASES = [
  ["@/common/", ["src/common/"]],
  ["@/ui/", ["src/ui/"]],
  ["@renderer/", ["src/renderer/src/"]],
  ["@test/", ["test/main/", "test/renderer/"]],
  ["@/", ["src/main/", "src/renderer/src/"]],
];
const CODE = /\.(ts|tsx|js|mjs|cjs|css|html|json|ya?ml|java|kts|gradle|astro)$/;
const PATHLIKE = /\.(ts|tsx|js|mjs|cjs|json|md|css|html|ya?ml|txt|java)$/;
const EXTENSIONS = ["", ".ts", ".tsx", ".js", ".mjs"];
const LOCALE = "src/common/i18n/locales/en.json";

function git(args, cwd = ".") {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 2 ** 28,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

// Null when git fails: a file missing at that ref, or a repository without commits.
function tryGit(args) {
  try {
    return git(args);
  } catch {
    return null;
  }
}

// The files a repository tracks or would add.
function listed(cwd) {
  return git(["ls-files", "--cached", "--others", "--exclude-standard"], cwd)
    .split("\n")
    .filter((f) => f && existsSync(join(cwd, f)));
}

// A rule's `paths`, or null without them: such a rule loads in every session.
function rulePaths(text) {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm || !/^paths:/m.test(fm[1])) return null;
  const inline = fm[1].match(/^paths:\s*\[(.*)\]/m);
  if (inline)
    return [...inline[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
  return [...fm[1].matchAll(/^\s+-\s+["']?([^"'\r\n]+?)["']?\s*$/gm)].map(
    (m) => m[1],
  );
}

// A glob as a regular expression, anchored at the root or, `anywhere`, at any folder.
function globRegex(glob, anywhere = false) {
  let re = "";
  let braces = 0;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      re += ".*";
      i += glob[i + 2] === "/" ? 2 : 1;
    } else if (c === "*") {
      re += "[^/]*";
    } else if (c === "?") {
      re += "[^/]";
    } else if (c === "{") {
      braces++;
      re += "(?:";
    } else if (c === "}" && braces) {
      braces--;
      re += ")";
    } else if (c === "," && braces) {
      re += "|";
    } else {
      re += c.replace(/[.+^$()|[\]\\{}]/, "\\$&");
    }
  }
  return new RegExp(`${anywhere ? "(^|/)" : "^"}${re}$`);
}

const headingsOf = (text) =>
  [...text.matchAll(/^#{1,6} +(.+?)\s*$/gm)].map((m) =>
    m[1].replaceAll("`", "").toLowerCase(),
  );

// Whether the words before "in `doc`" name one of its headings: "ok"; "broken" for a
// quoted or capitalized name that matches none; "pointer" for prose like "is in".
function sectionLink(before, headings) {
  const quoted = before.match(/"([^"]+)"\s*$/);
  const words = (quoted ? quoted[1] : before)
    .trim()
    .replace(/ section$/, "")
    .split(/\s+/);
  for (let k = 1; k <= Math.min(4, words.length); k++) {
    const name = words.slice(-k).join(" ").replace(/^\(/, "").toLowerCase();
    if (headings.includes(name)) return "ok";
  }
  return quoted || /^\(?[A-Z]/.test(words.at(-1) ?? "") ? "broken" : "pointer";
}

function oddChars(text) {
  const found = new Set();
  for (const ch of text) {
    const name = ODD.get(ch.codePointAt(0));
    if (name) found.add(name);
  }
  return [...found];
}

// Whether a path a doc names exists: an npm package, an alias, a glob, or the end of a
// repo path ("pages/Studio", "stage.ts").
function pathKnown(span, paths) {
  const p = span.replace(/[?#].*$/, "").replace(/\/+$/, "");
  if (existsSync(p) || existsSync(join("node_modules", p))) return true;
  const alias = ALIASES.find(([a]) => `${p}/`.startsWith(a));
  const tries = alias
    ? alias[1].map((t) =>
        (t + `${p}/`.slice(alias[0].length)).replace(/\/+$/, ""),
      )
    : [p];
  return tries.some((t) => {
    if (t.includes("*")) {
      const re = globRegex(t, true);
      return paths.some((x) => re.test(x));
    }
    return EXTENSIONS.some((e) =>
      paths.some((x) => x === t + e || x.endsWith(`/${t}${e}`)),
    );
  });
}

function selfTest() {
  assert.deepEqual(
    rulePaths('---\npaths:\n  - "src/a/**"\n  - "b.ts"\n---\n# A'),
    ["src/a/**", "b.ts"],
  );
  assert.deepEqual(rulePaths('---\npaths: ["src/a/**"]\n---\n'), ["src/a/**"]);
  assert.equal(rulePaths("# A rule without frontmatter"), null);
  assert.ok(
    globRegex("src/main/services/server/games*").test(
      "src/main/services/server/games.html",
    ),
  );
  assert.ok(globRegex("**/*.test.ts").test("src/a/b.test.ts"));
  assert.ok(globRegex("src/{a,b}/**").test("src/b/c.ts"));
  assert.ok(!globRegex("src/renderer/**").test("src/rendererx/a.ts"));
  assert.equal(sectionLink("see Persistence", ["persistence"]), "ok");
  assert.equal(sectionLink("(see Overlays repo", ["overlays repo"]), "ok");
  assert.equal(
    sectionLink('point to "Request numbering"', ["request numbering"]),
    "ok",
  );
  assert.equal(sectionLink("the Website section", ["website"]), "ok");
  assert.equal(sectionLink("see Cuts", ["gifts"]), "broken");
  assert.equal(sectionLink("Main's half is", ["data"]), "pointer");
  assert.deepEqual(
    oddChars(`a${String.fromCharCode(0xfeff)}b${String.fromCharCode(13)}`),
    ["U+FEFF", "CR"],
  );
  console.log("Self-test passed.");
}

function audit(args) {
  const from = args.includes("--from")
    ? args[args.indexOf("--from") + 1]
    : tryGit(["log", "-1", "--format=%h", "--grep=^docs: trim"])?.trim() ||
      null;
  const files = listed(".");
  // Vendored skills stay as published; .prettierignore lists them.
  const vendored = existsSync(".prettierignore")
    ? readFileSync(".prettierignore", "utf8")
        .split(/\r?\n/)
        .map((l) => l.trim().replace(/\/$/, ""))
        .filter((l) => l.startsWith(".claude/skills/"))
    : [];
  const isDoc = (f) =>
    f === "AGENTS.md" ||
    /^\.claude\/rules\/[^/]+\.md$/.test(f) ||
    (/^\.claude\/skills\/[^/]+\/[^/]+\.md$/.test(f) &&
      !vendored.some((v) => f.startsWith(`${v}/`)));
  const text = new Map(
    files.filter(isDoc).map((f) => [f, readFileSync(f, "utf8")]),
  );
  const then = new Map();
  if (from) {
    const old = git([
      "ls-tree",
      "-r",
      "--name-only",
      from,
      "--",
      "AGENTS.md",
      ".claude",
    ]);
    for (const f of old.split("\n").filter(isDoc))
      then.set(f, tryGit(["show", `${from}:${f}`]) ?? "");
  }
  const bytesNow = (f) => (text.has(f) ? Buffer.byteLength(text.get(f)) : 0);
  const bytesThen = (f) => (then.has(f) ? Buffer.byteLength(then.get(f)) : 0);
  const sum = (list, bytes) => list.reduce((total, f) => total + bytes(f), 0);
  const pad = (v) => String(v).padStart(7);
  const row = (now, was, label) =>
    console.log(`${pad(now)}${from ? ` ${pad(was)}` : ""}  ${label}`);
  const agents = text.get("AGENTS.md") ?? "";
  const rules = [...text.keys()].filter((f) => f.startsWith(".claude/rules/"));
  const failures = [];

  console.log(`## Sizes in bytes: now${from ? `, then at ${from}` : ""}\n`);
  const all = [...new Set([...text.keys(), ...then.keys()])].sort(
    (a, b) => bytesNow(b) - bytesNow(a) || a.localeCompare(b),
  );
  for (const f of all)
    row(
      text.has(f) ? bytesNow(f) : "gone",
      then.has(f) ? bytesThen(f) : "new",
      f,
    );
  const thenRules = [...then.keys()].filter((f) =>
    f.startsWith(".claude/rules/"),
  );
  const skillDocs = (list) =>
    list.filter((f) => f.startsWith(".claude/skills/"));
  console.log("");
  row(
    bytesNow("AGENTS.md"),
    bytesThen("AGENTS.md"),
    "AGENTS.md, in every session",
  );
  row(
    sum(rules, bytesNow),
    sum(thenRules, bytesThen),
    `all ${rules.length} rules`,
  );
  row(
    sum(skillDocs([...text.keys()]), bytesNow),
    sum(skillDocs([...then.keys()]), bytesThen),
    "the skills' docs",
  );

  // Which rules load with each file, as Claude Code matches their `paths`.
  const loadsOf = (ruleText) => {
    const map = new Map(files.map((f) => [f, new Set()]));
    const empty = [];
    for (const [rule, t] of ruleText) {
      const globs = rulePaths(t);
      if (globs === null) {
        for (const set of map.values()) set.add(rule);
        continue;
      }
      for (const g of globs) {
        const re = globRegex(g);
        const hits = files.filter((f) => re.test(f));
        if (!hits.length) empty.push(`${rule}: \`${g}\` matches no file`);
        for (const f of hits) map.get(f).add(rule);
      }
    }
    return { map, empty };
  };
  const now = loadsOf(rules.map((r) => [r, text.get(r)]));
  const before = from
    ? loadsOf(thenRules.map((r) => [r, then.get(r)])).map
    : null;
  failures.push(...now.empty);
  for (const r of rules)
    if (rulePaths(text.get(r)) === null)
      failures.push(`${r} has no \`paths\`, so it loads in every session`);
  const groups = new Map();
  for (const [f, set] of now.map) {
    if (!set.size) continue;
    const key = [...set]
      .map((r) => basename(r))
      .sort((a, b) => a.localeCompare(b))
      .join(" + ");
    const group = groups.get(key) ?? {
      bytes: bytesNow("AGENTS.md") + sum([...set], bytesNow),
      files: [],
    };
    group.files.push(f);
    groups.set(key, group);
  }
  console.log(
    "\n## Heaviest loads in bytes: AGENTS.md and the rules a file loads\n",
  );
  for (const [key, group] of [...groups]
    .sort((a, b) => b[1].bytes - a[1].bytes)
    .slice(0, 10)) {
    const was = before
      ? bytesThen("AGENTS.md") +
        sum([...(before.get(group.files[0]) ?? [])], bytesThen)
      : "";
    const count = group.files.length;
    row(
      group.bytes,
      was,
      `${key} (${count} file${count === 1 ? "" : "s"}, e.g. ${group.files[0]})`,
    );
  }

  for (const r of rules)
    if (!agents.includes(`\`${basename(r)}\``))
      failures.push(`${r} isn't in AGENTS.md's Topic rules`);
  const skills = files
    .filter((f) => /^\.claude\/skills\/[^/]+\/SKILL\.md$/.test(f))
    .map((f) => f.split("/")[2]);
  for (const s of skills)
    if (!agents.includes(`\`${s}\``))
      failures.push(`the ${s} skill isn't in AGENTS.md's Skills`);

  const own = files
    .filter(
      (f) =>
        (CODE.test(f) || /^\.\w+rc$/.test(basename(f))) &&
        !/lock/i.test(basename(f)),
    )
    .filter((f) => f !== SELF && statSync(f).size < 2e6)
    .map((f) => [f, readFileSync(f, "utf8")]);
  for (const [f, t] of [...text, ...own]) {
    for (const m of t.matchAll(/\.claude\/(rules\/[\w-]+\.md|skills\/[\w-]+)/g))
      if (!existsSync(`.claude/${m[1]}`))
        failures.push(`${f} names .claude/${m[1]}, which doesn't exist`);
  }

  const headings = new Map([...text].map(([f, t]) => [f, headingsOf(t)]));
  for (const [doc, t] of text) {
    for (const m of t.matchAll(
      / (?:in|of) `(AGENTS\.md|\.claude\/rules\/[\w-]+\.md)`/g,
    )) {
      if (!headings.has(m[1])) continue;
      const before = t
        .slice(Math.max(0, m.index - 80), m.index)
        .split("\n")
        .at(-1);
      if (sectionLink(before, headings.get(m[1])) === "broken")
        failures.push(
          `${doc}: "…${before.slice(-30)}" in \`${m[1]}\` names no heading there`,
        );
    }
    for (const m of t.matchAll(/\(see ([A-Z][\w -]*?)(?: for [^)]*)?\)/g)) {
      // "(see Linux checks in WSL below)" names the heading it starts with.
      const name = m[1].toLowerCase();
      if (
        !headings.get(doc).some((h) => name === h || name.startsWith(`${h} `))
      )
        failures.push(`${doc}: "(see ${m[1]})" names no heading in it`);
    }
    for (const m of t.matchAll(/the `([\w-]+)` skill/g))
      if (!skills.includes(m[1]))
        failures.push(`${doc} names the ${m[1]} skill, which doesn't exist`);
    const odd = oddChars(t);
    if (odd.length) failures.push(`${doc} has ${odd.join(", ")}`);
  }

  // Names: anything in the code, this repo's or a sibling repo's the docs name, counts.
  const siblings = [
    ...new Set(
      [...text.values()].flatMap((t) => t.match(/\.\.\/tokio-[\w-]+/g) ?? []),
    ),
  ]
    .filter((d) => existsSync(join(d, ".git")))
    .map((d) => [d, listed(d)]);
  const corpus = [
    ...own.map(([, t]) => t),
    ...siblings.flatMap(([d, list]) =>
      list
        .filter((f) => CODE.test(f) && !/lock/i.test(basename(f)))
        .map((f) => join(d, f))
        .filter((p) => statSync(p).size < 2e6)
        .map((p) => readFileSync(p, "utf8")),
    ),
  ].join("\n");
  const words = new Set(corpus.match(/[A-Za-z_$][\w$]*/g));
  const keys = existsSync(LOCALE)
    ? Object.keys(JSON.parse(readFileSync(LOCALE, "utf8"))).map((k) =>
        k.replace(/#\w+$/, ""),
      )
    : [];
  const paths = [
    ...new Set(
      [...files, ...siblings.flatMap(([, list]) => list)].flatMap((f) => {
        const out = [f];
        for (let d = dirname(f); d !== "."; d = dirname(d)) out.push(d);
        return out;
      }),
    ),
  ];
  const names = [];
  for (const [doc, t] of text) {
    const misses = new Set();
    const body = t
      .replace(/^---\r?\n[\s\S]*?\r?\n---/, "")
      .replace(/^```[\s\S]*?^```/gm, "");
    for (const [, raw] of body.matchAll(/`([^`\n]+)`/g)) {
      const s = raw.trim();
      const sibling = s.match(/^\.\.\/(tokio-[\w-]+)(\/[^<\s]*)?/);
      if (sibling) {
        const repo = join("..", sibling[1]);
        if (existsSync(repo) && !existsSync(repo + (sibling[2] ?? "")))
          misses.add(s);
        continue;
      }
      if (
        /\s|<|^(https?:|[~$!#/-])/.test(s) ||
        !/[A-Za-z]/.test(s) ||
        /^(out|music-out|dist|coverage)\//.test(s) ||
        skills.includes(s) ||
        corpus.includes(s)
      )
        continue;
      if (s.includes("/") || PATHLIKE.test(s) || /^\.[\w-]+$/.test(s)) {
        if (!pathKnown(s, paths)) misses.add(s);
        continue;
      }
      const key = s.replace(/\.\*$/, "");
      if (keys.some((k) => k === key || k.startsWith(`${key}.`))) continue;
      const parts = s.replace(/\(.*\)$/, "").split(".");
      if (
        parts.every(
          (p) =>
            /^[A-Za-z_$][\w$]*$/.test(p) && (p.length <= 3 || words.has(p)),
        )
      )
        continue;
      misses.add(s);
    }
    if (misses.size) names.push(`- ${doc}: ${[...misses].join(" | ")}`);
  }

  console.log("\n## Failures\n");
  console.log(
    failures.length ? failures.map((f) => `- ${f}`).join("\n") : "None.",
  );
  console.log(
    "\n## Names the code doesn't have (most are external or user data)\n",
  );
  console.log(names.length ? names.join("\n") : "None.");
  if (args.includes("--strict") && failures.length) process.exitCode = 1;
}

if (process.argv.includes("--self-test")) selfTest();
else audit(process.argv.slice(2));
