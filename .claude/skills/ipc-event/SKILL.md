---
name: ipc-event
description: "Add or change an IPC request, reply or push between a page and the main process, with its handler, feedback, renderer side and tests. Use when a page needs data or an action from main, or main has to tell a page something."
argument-hint: "<area> <action>"
---

# Add an IPC event

Follow IPC events and Feedback in `AGENTS.md`. This adds the shapes the code uses; `src/main/events/pages/updates.ts` and `updates.test.ts` are short examples of each.

## Types

- The request goes in `src/common/types/events/req.ts`: `APP_EVENTS.<NAME> = "app:<area>:<action>"`, and its payload in `AppEventsMap` (`void` when there's none).
- The reply or push goes in `src/common/types/events/res.ts`: `APP_EVENTS_RESPONSE.<NAME> = "app:<area>:res:<action>"`, and its payload in `AppEventsResponseMap`. A reply that can fail is a `Reply<{ ... }>`. A reply about one item carries its id, failures included.
- New feedback codes go in `FEEDBACK_CODES` (`src/common/types/feedback.ts`): past tense for successes (`PROFILE_CREATED`), `_FAILED` at the end for failures.

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
        "Unable to check for updates. Check your connection.",
        { level: "warning", logged: true, cause: res.error },
      );
    }
    e.reply(APP_EVENTS_RESPONSE.CHECK_UPDATES, { success: true });
  },
  {
    notify: false, // About shows the failure
    failure: {
      code: FEEDBACK_CODES.UPDATE_CHECK_FAILED,
      message: "Unable to check for updates.",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.CHECK_UPDATES),
  },
);
```

- A user action that changes something calls `notifier.success(source, code, message)` after its reply; `notifier` is among the services. Reads, status checks and autosaves send nothing.
- To push without a request: `win.webContents.send(APP_EVENTS_RESPONSE.<NAME>, data)`, with `undefined` for a `void` payload.

## Renderer

- Send with `window.api.emit(APP_EVENTS.<NAME>, data)`, or `useIpcRequest(APP_EVENTS.<NAME>, data)` to send once when the component mounts.
- Listen with `useIpcListener(APP_EVENTS_RESPONSE.<NAME>, (data) => { ... })`, and drop a reply whose id isn't the item on screen.
- Don't show the failure as a notice: main sends one, unless the handler has `notify: false`.

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

## Done when

Both sides are typed, the success and failure paths have tests, and the `verify` checks pass.
