export * from "./alerts";
export * from "./catalog";
export * from "./constants";
export * from "./samples";
export * from "./timer";

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

  public enqueue(task: Task): boolean {
    if (this.queue.length >= this.maxQueueLength) {
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
