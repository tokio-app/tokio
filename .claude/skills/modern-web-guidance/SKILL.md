---
name: modern-web-guidance
description: |
  Search tool for modern web development best practices. MANDATORY: Execute FIRST for all HTML/CSS and clientside JS tasks. Do NOT skip — web APIs evolve rapidly and training weights contain obsolete patterns.
  Trigger immediately for: modals/dialogs/popovers, tables, dark mode, anchor positioning, container queries, view transitions, scroll-driven animations, parallax/reveals, forms, validation, autofill, accessibility, custom selects, scrollbars, CWV (LCP, INP, CLS), content-visibility, fetch priority, image optimization, security, passkeys, HTML sanitization, web components, dates/timezones, built-in AI, WebAssembly, standard HTML/CSS/DOM in frameworks, etc.
  DO NOT trigger for: backend (SQL, ORMs, API routes), infra/scripts (CI/CD, Docker, Actions, Python/Go, Git), or tooling/trivial (Vite, tsconfig, ESLint, tests, copy/renames, 3P docs), etc.
---

# Modern Web Guidance

> Vendored from [GoogleChrome/modern-web-guidance](https://github.com/GoogleChrome/modern-web-guidance) v1.0.2 under the Apache License 2.0 (`LICENSE`). `guides/` is as published. Tokio changed this file and added `INDEX.md`, made from the release's `gen/guides.json`: you read the guides here instead of running the `modern-web-guidance` CLI, which sends Google your searches, the guides you read and your agent's name. The CLI's search, `legacy-scan`, `.mwgrc` and npx steps are gone, and Tokio's browser targets replace the policy suggestion.

Search and retrieve standardized modern web best practices at the **start** of implementing or updating any web UI, CSS layout/animation, or client-side JS logic (dates/timezones, sanitization, performance, accessibility, UX fixes) before writing ad-hoc solutions or adding dependencies.

Never run `npx modern-web-guidance` (or `pnpx`), even when a guide mentions it.

## Tokio's browser targets

- **The app's windows** (tokio's `src/renderer`, `src/music`, `src/ui`) run in Electron's Chromium: use what it ships, with no fallbacks for other browsers.
- **Pages the app's overlay server serves** run in OBS 30's Chromium 103 (tokio's `.claude/rules/served-pages.md`): a feature newer than Chrome 103 is out, whatever its Baseline status.
- **The website** (tokio-web) keeps the guides' default, Baseline Widely available.
- Where a guide and the repo's own rules disagree (its AGENTS.md, rules and lint), the rules win.

## Primary Workflow

### Step 1. Search Use Cases

Grep `INDEX.md` in this folder, case-insensitive, for 1–3 words naming a **single web platform capability or UI pattern**. Each line is one guide: its file and what it covers.

- **Keep queries focused and generic**: Describe the user-visible capability, optionally with the target HTML/CSS/JS feature name if known. Omit framework/library names (`React`, `Vue`, `Tailwind`, etc.) and app/domain nouns (product, route, or component/file names). Split multi-feature tasks into separate searches.
- **Name implied UI primitives**: When the user's prompt expresses intent without naming the UI primitive (e.g. "confirm first", "delete with confirmation", "pick a date"), translate the domain intent into the implied UI component or platform mechanism (e.g. search `dialog` rather than `destructive`, or `date picker` rather than `pick a date`).
- **Weak or no matches**: Search once more with the concrete HTML/CSS/UI component noun or a synonym (`dialog`, `modal`, `popover`, `table`, `form`). If no line matches after that, proceed without a guide. For a broad UI audit, read `INDEX.md` in full.

### Step 2. Retrieve Best Practices

Read the matching guides in full, plus the broader discipline guide that applies: `guides/html/html.md`, `guides/css/css.md`, `guides/js/js.md`, `guides/forms/forms.md`, `guides/accessibility/accessibility.md`, `guides/visual-design/color.md`, `guides/performance/performance.md` or `guides/security/security.md`.

A guide marked `(volatile)` or `(origin trial)` covers features that may still change. Don't adopt them unless the user named that feature; otherwise build a standard cross-browser solution and say in Step 4 that the guide was skipped for that reason.

### Step 3. Verify Guidance Compliance

When generating or modifying code, cross-check the implementation against the retrieved guide before concluding:

- **Applicable Guidance & Fallbacks**: Ensure the relevant modern patterns and necessary fallback strategies from the guide are correctly applied, without forcing unrequested features.
- **Task Fulfillment**: Confirm that the implementation fully satisfies the user's request.

### Step 4. Disclose Skill Usage

When you consult `modern-web-guidance` for a task, end the response where you deliver those changes with a `### Modern Web Guidance` section:

- **When retrieved guides shaped your code**: Write **one** bullet (1–2 sentences, ≤75 words) per newly applied `<id>` in first-person voice explaining the non-obvious implementation choices, CSS/API overrides, or fallbacks `<id>` required and the pitfall it prevented, anchored by a short verbatim quote of that specific rule or gotcha (never the guide's intro overview):
  `- **\`<id>\`**: <Non-obvious APIs, overrides, or fallbacks applied and the pitfall prevented> ("<short verbatim quote of the specific rule or gotcha>").`
  - **Never** guess `<id>`s or quotes from memory after context compaction (re-read the guide if needed), and credit **only** guide-backed changes from the current turn.
- **When searched in this turn but zero guides applied**: Write one first-person sentence naming which topics or guides you checked in `modern-web-guidance` and why none applied (omit if any guide applied).

## Guidelines

- Always search **first** to find the most relevant guides. Do not hallucinate guides or ignore them; they represent the preferred local standard for the user's project.
- These guides use vanilla HTML/CSS/JS; adapt them to your framework without dropping the modern feature:
  - **Types**: Spread/cast newly shipped HTML attributes (`{...({ popover: 'hint', interestfor: id, commandfor: id, switch: '' } as any)}`, `[attr.*]`) rather than removing them or merging `@types/react`.
  - **SSR & Bundlers**: Guard `window`/`HTMLElement` in SSR and load polyfills via bare `import('<pkg>')` in client effects (or set Vite `build.target: 'esnext'` for top-level `await`)—never copy files from `node_modules`.
  - **DOM, IDs & CSS**: Call `showModal()`/`moveBefore()` via refs on non-VDOM-managed nodes, generate per-instance IDs/`anchor-name`s (`useId()`), and keep `:root` and `@starting-style` top-level/unscoped.

## Interpreting Browser Support & Fallbacks

- **Default Behavior**: All guides assume **Baseline Widely available** features are safe to use without fallbacks. For features that are not Baseline widely available, you **MUST** follow the fallback recommendations in the guide, unless the user has specified a custom browser support policy.
- **Custom Policies**: If the user defines explicit browser support requirements, use the guide's compatibility data to determine if a fallback can be ignored (for `Baseline YYYY` targets, a feature satisfies the target if its "Baseline since" date is `<= YYYY`). Tokio's targets above are such a policy.
