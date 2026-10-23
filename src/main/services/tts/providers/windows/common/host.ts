import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import { existsSync } from "fs";
import { createInterface } from "readline";
import config from "../config";
import { SapiRequest, SapiResponse, SapiResponseMap } from "../types";
import { ENCODED_SCRIPT } from "./script";

type Pending = {
  // Response data is trusted to match the request type, see SapiResponseMap.
  resolve: (data: any) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export class SapiHost {
  private _child: ChildProcessWithoutNullStreams | null = null;
  private _pending: Map<number, Pending> = new Map();
  private _nextId = 1;
  private _stderr = "";
  private _idleTimer: NodeJS.Timeout | null = null;
  // Whether the host has answered since it spawned, see START_TIMEOUT_MS
  private _ready = false;

  private _resolvePowerShell() {
    return (
      config.POWERSHELL_PATHS.find((p) => existsSync(p)) || "powershell.exe"
    );
  }

  private _spawn() {
    const child = spawn(
      this._resolvePowerShell(),
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        ENCODED_SCRIPT,
      ],
      { windowsHide: true, stdio: "pipe" },
    );

    this._stderr = "";
    this._ready = false;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this._stderr = (this._stderr + chunk).slice(-2000);
    });

    createInterface({ input: child.stdout }).on("line", (line) => {
      this._onLine(line);
    });

    child.stdin.on("error", (error) => this._onExit(child, error));
    child.on("error", (error) => this._onExit(child, error));
    child.on("exit", (code) =>
      this._onExit(
        child,
        new Error(
          `SAPI host exited with code ${code}${this._stderr ? ` - ${this._stderr.trim()}` : ""}`,
        ),
      ),
    );

    this._child = child;
    return child;
  }

  private _onLine(line: string) {
    let res: SapiResponse;
    try {
      res = JSON.parse(line);
    } catch {
      return;
    }
    const pending = this._pending.get(res.id);
    if (!pending) return;
    this._pending.delete(res.id);
    this._ready = true;
    clearTimeout(pending.timer);
    this._armIdle();
    if (res.ok) {
      pending.resolve(res.data);
    } else {
      pending.reject(new Error(res.error || "Unknown SAPI error"));
    }
  }

  private _onExit(child: ChildProcessWithoutNullStreams, error: Error) {
    if (this._child !== child) return;
    this._child = null;
    this._clearIdle();
    for (const pending of this._pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this._pending.clear();
  }

  public request<K extends SapiRequest["type"]>(
    req: Extract<SapiRequest, { type: K }>,
  ): Promise<SapiResponseMap[K]> {
    const child = this._child ?? this._spawn();
    const id = this._nextId++;
    const timeout = this._ready
      ? config.REQUEST_TIMEOUT_MS
      : config.START_TIMEOUT_MS;
    this._clearIdle();

    return new Promise((resolve, reject) => {
      // A stuck host is dropped before it's killed, which exits later, so the
      // next request spawns a new one. Its other requests fail with this one.
      const timer = setTimeout(() => {
        this._onExit(child, new Error(`SAPI request "${req.type}" timed out`));
        child.kill();
      }, timeout);

      this._pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ ...req, id })}\n`, "utf8");
    });
  }

  // A host with nothing to do holds memory, so it exits after a while.
  private _armIdle() {
    if (this._pending.size > 0 || !this._child) return;
    this._clearIdle();
    this._idleTimer = setTimeout(() => this.dispose(), config.IDLE_TIMEOUT_MS);
    this._idleTimer.unref();
  }

  private _clearIdle() {
    if (this._idleTimer) clearTimeout(this._idleTimer);
    this._idleTimer = null;
  }

  public dispose() {
    const child = this._child;
    if (!child) return;
    this._onExit(child, new Error("SAPI host disposed"));
    child.stdin.end();
    child.kill();
  }
}
