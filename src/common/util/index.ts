export * from "./alerts";
export * from "./catalog";
export * from "./constants";
export * from "./format";
export * from "./games";
export * from "./history";
export * from "./platforms";
export * from "./rows";
export * from "./samples";
export * from "./studio";
export * from "./timer";
export * from "./youtube";

/** Orders versions as semver does: 0.1.3-beta.2 < 0.1.3-beta.10 < 0.1.3 < 0.1.10 */
export function compareVersions(a: string, b: string): number {
  const [coreA, preA] = a.split("-");
  const [coreB, preB] = b.split("-");
  const byNumbers = (x: string, y: string) =>
    x.localeCompare(y, "en", { numeric: true });

  const core = byNumbers(coreA, coreB);
  if (core !== 0) return core;
  // A release comes after its own prereleases
  if (!preA && !preB) return 0;
  if (!preA) return 1;
  if (!preB) return -1;
  return byNumbers(preA, preB);
}

/** The language without its script or region, lowercase: zh-Hans is zh. */
export const baseLanguage = (code: string) =>
  code.split(/[-_]/)[0].toLowerCase();

export function formatError(error: unknown): string {
  return describeError(error, 0);
}

function describeError(error: unknown, depth: number): string {
  if (error instanceof Error) {
    const message = error.message || error.name;
    if (error.cause === undefined || depth >= 3) return message;
    return `${message} -- cause: ${describeError(error.cause, depth + 1)}`;
  }
  if (typeof error === "string") return error || "unknown";
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((res) => {
    setTimeout(() => {
      res();
    }, ms);
  });
}

interface TaskQueueOptions {
  maxQueueLength?: number;
  gapTime?: number;
}

type Task = () => void | Promise<void>;

export class TaskQueue {
  private queue: Task[] = [];
  private isProcessing: boolean = false;
  private run: number = 0;

  public maxQueueLength: number;
  public gapTime: number;

  constructor() {
    this.maxQueueLength = Infinity;
    this.gapTime = 0;
  }

  public setQueueOptions(options: TaskQueueOptions) {
    this.maxQueueLength = options.maxQueueLength ?? Infinity;
    this.gapTime = options.gapTime ?? 0;
  }

  // As many tasks wait as it holds, so enqueue would drop a new one
  public full(): boolean {
    return this.queue.length >= this.maxQueueLength;
  }

  public enqueue(task: Task): boolean {
    if (this.full()) {
      return false;
    }

    this.queue.push(task);
    this.start();

    return true;
  }

  public start() {
    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  public stop() {
    this.queue = [];
    this.isProcessing = false;
  }

  private async processQueue() {
    // A loop stopped while awaiting a task or the gap can wake up after a new
    // one started. The run id makes it exit instead of running alongside it.
    const run = ++this.run;
    const active = () => this.isProcessing && this.run === run;
    this.isProcessing = true;

    while (this.queue.length > 0 && active()) {
      const task = this.queue.shift();

      if (task) {
        try {
          await task();
        } catch (error) {
          console.error("TaskQueue: Error executing task", error);
        }
      }

      if (this.queue.length > 0 && this.gapTime > 0 && active()) {
        await delay(this.gapTime * 1000);
      }
    }

    if (this.run === run) this.isProcessing = false;
  }
}
