/**
 * Calls `fn` right away, then at most once every `ms`: calls in between wait
 * for the end of the window, and only the latest one runs. `cancel()` drops
 * the one waiting.
 */
export function throttle<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waiting: A | undefined;

  const tick = () => {
    if (!waiting) {
      timer = undefined;
      return;
    }
    const args = waiting;
    waiting = undefined;
    timer = setTimeout(tick, ms);
    fn(...args);
  };

  const throttled = (...args: A) => {
    if (timer) {
      waiting = args;
      return;
    }
    timer = setTimeout(tick, ms);
    fn(...args);
  };

  throttled.cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    waiting = undefined;
  };

  return throttled;
}
