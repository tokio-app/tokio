// Work a quit would cut off: IPC handlers and file writes.
const pending = new Set<Promise<unknown>>();

/** Keeps the app from quitting until `promise` settles (see settle). */
export function track<T>(promise: Promise<T>): Promise<T> {
  pending.add(promise);
  const done = () => pending.delete(promise);
  promise.then(done, done);
  return promise;
}

export const hasPending = () => pending.size > 0;

/**
 * Resolves once nothing is pending, including work started meanwhile, or
 * after `ms` at most.
 */
export async function settle(ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(resolve, ms, "timeout");
    timer.unref?.();
  });
  while (pending.size) {
    const first = await Promise.race([Promise.allSettled(pending), timeout]);
    if (first === "timeout") break;
  }
  clearTimeout(timer);
}
