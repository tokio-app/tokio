---
name: ipc-event
description: "Add or change an IPC request, reply or push between a page and the main process, with its handler, feedback, renderer side and tests. Use when a page needs data or an action from main, or main has to tell a page something."
argument-hint: "<area> <action>"
---

# Add an IPC event

Follow IPC events and Feedback in `AGENTS.md`. This adds the shapes the code uses; `src/main/events/pages/updates.ts` and `updates.test.ts` are short examples of each.

## Types

- The request goes in `src/common/types/events/req.ts`: `APP_EVENTS.<NAME> = "app:<area>:<action>"`, and its payload in `AppEventsMap` (`void` when there's none).
- The reply or push goes in `src/common/types/events/res.ts`: `APP_EVENTS_RESPONSE.<NAME> = "app:<area>:res:<action>"`, and its payload in `AppEventsResponseMap`. A reply that can fail is a `Reply<{ ... }>`; one about an item carries its id.
- New feedback codes go in `FEEDBACK_CODES` (`src/common/types/feedback.ts`), named as Feedback in `AGENTS.md` says.

## Handler

In `src/main/events/pages/<page>.ts`. A new file is a new stack: add it to `mergeStacks` in `src/main/events/index.ts`.

```ts
const events = createStack("system"); // the FeedbackSource of the page's handlers

events.push(
  APP_EVENTS.CHECK_UPDATES,
  async ({ updaterService }, e) => {
    const res = await updaterService.check();
    if (!res.success) {
      // An expected failure with its own message, already logged by the service
      throw new AppFailure(
        FEEDBACK_CODES.UPDATE_CHECK_FAILED,
        t("main.updates.checkFailed"), // in the user's language, see below
        { level: "warning", logged: true, cause: res.error },
      );
    }
    e.reply(APP_EVENTS_RESPONSE.CHECK_UPDATES, { success: true });
  },
  {
    notify: false, // About shows the failure
    failure: {
      code: FEEDBACK_CODES.UPDATE_CHECK_FAILED,
      message: "main.failure.checkUpdates", // a key, translated when reported
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.CHECK_UPDATES),
  },
);
```

- Texts the user sees come from `src/common/i18n/locales/` (`.claude/rules/i18n.md`): add the English to `en.json`'s `main.*` block and the same key to `es-419.json`. Messages made in the handler use `t(key, params)` from `@/helper/i18n`; `failure.message` is the key alone.
- A user action that changes something calls `notifier.success(source, code, message)` after its reply (Feedback in `AGENTS.md`).
- A push without a request: `win.webContents.send(APP_EVENTS_RESPONSE.<NAME>, data)`.

## Renderer

- Send with `window.api.emit(APP_EVENTS.<NAME>, data)`, or `useIpcRequest(APP_EVENTS.<NAME>, data)` to send once when the component mounts.
- Listen with `useIpcListener(APP_EVENTS_RESPONSE.<NAME>, (data) => { ... })`, and drop a reply whose id isn't the item on screen. Main shows failures (unless `notify: false`), not the page.

## Tests

- Main, in `<page>.test.ts` next to the stack:

  ```ts
  const check = vi.fn(async () => ({ success: true }));
  const h = createHandler({ updaterService: { check } });

  await h.invoke(updates, APP_EVENTS.CHECK_UPDATES);

  expect(h.replies(APP_EVENTS_RESPONSE.CHECK_UPDATES)).toEqual([
    { success: true },
  ]);
  expect(h.notices).toEqual([]);
  ```

  Cover the failure as well: its reply, its notice or none, and what was logged.

- Renderer, next to the page: `await send(APP_EVENTS_RESPONSE.<NAME>, data)` from `@test/ipc` for main's reply. `sent(APP_EVENTS.<NAME>)` lists the payloads the page sent, and `sentEvents()` the events in order.

## MCP

A request that changes something users can change needs its MCP field, kind or tool (Conventions in `AGENTS.md`, `.claude/rules/mcp.md`).

## Done when

Both sides are typed, the success and failure paths have tests, and the `verify` checks pass.
