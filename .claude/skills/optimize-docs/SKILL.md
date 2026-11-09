---
name: optimize-docs
description: "Measure, audit and trim the agent docs (AGENTS.md, .claude/rules and the project's own skills): what each file loads, stale names, broken links and repeats, then a trim by parallel agents and a full review of their work. Use when asked to optimize, trim, clean up or audit the agent docs, or when the rules have grown a lot since the last pass."
argument-hint: "[rules or an area]"
---

# Optimize the agent docs

Each feature updates its rule, so the rules grow. This pass brings them back to the standard in the Writing section of the `sync-docs` skill: a rule keeps the user's calls, gotchas, contracts and couplings, and drops what the code shows. Never cut a user's call, a gotcha or a contract to save bytes.

## Where things stand

!`node .claude/skills/optimize-docs/scripts/audit.mjs`

`scripts/audit.mjs` compares each doc with the last `docs: trim` commit (`--from <ref>` picks another) and lists the rule sets that load the most text, each with a file that loads it. Its failures are what a trim can break: a rule glob that matches no file, a rule or skill AGENTS.md doesn't list, a missing rule or skill a doc names, a section link to a heading that's gone, a BOM, CR or zero-width character. Its names list is only a lead: most are Minecraft, browser, TikTok or user-data names. After changing the script, run it with `--self-test`.

## 1. Plan

With an argument, work on those rules and the facts they share; otherwise on all of them.

1. Read AGENTS.md, every rule and the project's own skills. The vendored skills `.prettierignore` lists stay as published.
2. Find:
   - **Repeats:** a fact two docs state. Pick its home; the others point to it, at most once. A pattern three or more rules repeat goes in AGENTS.md when every session needs it (in-memory profile data), otherwise in a rule with those files' `paths` (`served-pages.md`).
   - **Splits:** a rule whose halves concern files that rarely change together, like Overlay Studio's stream side and its editor. The second half opens with "Builds on `.claude/rules/<first>.md`".
   - **AGENTS.md sections only some files need**, like the CI details. Move them to a rule with those `paths`, and leave a one-line pointer where a reader elsewhere could trip (`packaging.test.ts` skipping query imports).
   - **Heavy loads:** the rule sets at the top of the audit. Split them or narrow their `paths`.
   - **Stale names:** check the audit's leads against the code.
3. Write down each move with its exact text, the home of each shared fact, and the headings other docs link to.

## 2. Trim in parallel

- Give each Opus 5.5 agent its own rules, about 35–45 KB of them, at the effort AGENTS.md's Agent models gives: high for a split or for rules full of measured facts (games), medium for the rest. Docs only, so they share the main checkout, with no worktrees.
- Brief each with the template below, filled in. Meanwhile, do AGENTS.md and the skills yourself, the facts moving into AGENTS.md included.
- One or two rules don't need agents: do them yourself, with the brief as your checklist.

### The brief

```
You're trimming agent docs in the Tokio repo (<repo path>). Docs only, no code changes. Other agents are trimming other rules in this checkout at the same time, so edit only your files.

## Your files

<each rule, with its size; a split, with each new file's `paths`>

## The standard

A rule loads when an agent reads a file its `paths` match, so its reader is about to change that code and can read it too. The standard is the Writing section of `.claude/skills/sync-docs/SKILL.md` and the paragraph under AGENTS.md's Topic rules list: read both. For this trim:

- Keep every user's call, once, inline, marked "(the user's call)", and each gotcha's reason in one clause.
- Drop what reading the code shows, constants' values that aren't decisions or platform facts (keep the name), history unless "not X: it broke Y" stops a revert, and anything AGENTS.md (always loaded) or another rule says.
- Where a sentence is already tight, leave it. Where you compress, keep the meaning exact.
- The repo's voice: short plain sentences, one fact per bullet, names and paths in backticks, UI names in bold.
- The targets (<bytes per file>) are guides, not quotas: never drop a user's call, a gotcha or a contract to reach one.

## Moves and homes

<facts that now live elsewhere, and where: drop them, keeping the area's own consequences>
<facts to add: their exact text, and the code to check it against>
<facts other files own: point to them at most once>
<headings other docs link to: keep them, or report the rename>
<known stale names>

## How

1. Read AGENTS.md, then your files.
2. Keep, compress or drop each fact. `git log --follow -p -- <file>` and the commits' messages say why a line was added and whether it was the user's call. Check the code for a fact you keep but doubt: fix renamed names, and drop what's no longer true. Add no facts but the moves.
3. Run `npx prettier --write <your files>`, then `node .claude/skills/optimize-docs/scripts/audit.mjs`, and fix the real hits in your files.

Edit only your files. Run no git command that changes anything (stash, checkout, add, commit, reset); read-only git is fine. Prefix scratch files with your area. Text for AGENTS.md or another file goes in your report.

## Report

- Each file's bytes before and after.
- What you dropped, by kind, with two or three examples each.
- The facts you weren't sure of, and what you checked.
- Stale names fixed, `paths` changes and heading renames.
- Text for files you don't own.
```

## 3. Review every result

Read each file whole, not just its diff stats. Trims go wrong in these ways:

- A fact dropped as a repeat that's stated nowhere else. Grep the docs for it, and restore it in its home.
- A claim reworded past what the code does: one trim said `LibraryPicker` served the sound picker. Check reworded claims against the code.
- A user's call that lost its marker, or a gotcha that lost its reason.
- Frontmatter that isn't in the block style the other rules use.

Fix them with small edits as you go.

## 4. Integrate

1. Update AGENTS.md's Topic rules list for new and split rules, its Skills list for skills, and every link to a renamed heading.
2. Run `npx prettier --write` on the docs you touched.
3. Run the audit: its Failures must say None, and its names list hold only external names.

## Done when

The audit passes, and the user has a table of what loads before and after (AGENTS.md, all rules, the heaviest rule sets), what moved where, and what you fixed or restored in review. Commit only when asked, as `docs: trim and restructure the agent docs`: the next audit measures from it.
