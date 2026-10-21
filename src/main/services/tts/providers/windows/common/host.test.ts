import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import config from "../config";
import { SapiHost } from "./host";

// Off for a host that's stuck: it reads requests and never answers.
let answering = true;

// Stands in for the PowerShell process and answers every request.
class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn(() => {
    this.emit("exit", null);
    return true;
  });

  constructor() {
    super();
    this.stdin.setEncoding("utf8");
    this.stdin.on("data", (line: string) => {
      if (!answering) return;
      const { id } = JSON.parse(line);
      this.stdout.write(`${JSON.stringify({ id, ok: true, data: [] })}\n`);
    });
  }
}

// Read by the mock only once a test runs, after this is defined.
const children: FakeChild[] = [];

vi.mock("child_process", () => ({
  spawn: vi.fn(() => {
    const child = new FakeChild();
    children.push(child);
    return child;
  }),
}));

const child = (i: number) => children[i];

describe("SapiHost", () => {
  let host: SapiHost;

  beforeEach(() => {
    vi.useFakeTimers();
    answering = true;
    children.length = 0;
    host = new SapiHost();
  });

  afterEach(() => {
    host.dispose();
    vi.useRealTimers();
  });

  it("stops the host after it sits idle, and respawns it when needed", async () => {
    await host.request({ type: "voices" });
    expect(children).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(config.IDLE_TIMEOUT_MS - 1);
    expect(child(0).kill).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(child(0).kill).toHaveBeenCalledOnce();

    await host.request({ type: "voices" });
    expect(children).toHaveLength(2);
  });

  it("keeps a host that keeps getting requests", async () => {
    await host.request({ type: "voices" });
    await vi.advanceTimersByTimeAsync(config.IDLE_TIMEOUT_MS - 1);
    await host.request({ type: "voices" });
    await vi.advanceTimersByTimeAsync(config.IDLE_TIMEOUT_MS - 1);

    expect(child(0).kill).not.toHaveBeenCalled();
    expect(children).toHaveLength(1);
  });

  it("kills a host that doesn't answer, and respawns it for the next request", async () => {
    answering = false;
    const stuck = expect(host.request({ type: "voices" })).rejects.toThrow(
      'SAPI request "voices" timed out',
    );

    await vi.advanceTimersByTimeAsync(config.REQUEST_TIMEOUT_MS);
    await stuck;
    expect(child(0).kill).toHaveBeenCalledOnce();

    answering = true;
    await host.request({ type: "voices" });
    expect(children).toHaveLength(2);
  });

  it("fails the requests of a host that exits, with what it wrote to stderr", async () => {
    answering = false;
    const pending = host.request({ type: "voices" });
    const failed = expect(pending).rejects.toThrow(
      "SAPI host exited with code 1 - Access denied",
    );

    child(0).stderr.write("Access denied\n");
    await vi.advanceTimersByTimeAsync(0);
    child(0).emit("exit", 1);
    await failed;

    answering = true;
    await host.request({ type: "voices" });
    expect(children).toHaveLength(2);
  });
});
