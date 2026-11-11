import { settle } from "@/helper/quit";
import { strFromU8, unzipSync } from "fflate";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Logger, { localTime } from "./index";

const LIMIT = 5 * 1024 * 1024;

describe("Logger", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tokio-test-"));
    file = join(dir, "test.log");
  });

  afterEach(async () => {
    vi.useRealTimers();
    await settle(5_000);
    await rm(dir, { recursive: true, force: true });
  });

  const lines = async (path = file) =>
    (await readFile(path, "utf-8")).trimEnd().split("\n");

  it("writes a burst of lines in call order", async () => {
    for (let i = 0; i < 50; i++) Logger.info(`line ${i}`, file);
    await settle(5_000);

    const written = await lines();
    expect(written).toHaveLength(50);
    written.forEach((line, i) =>
      expect(line).toMatch(new RegExp(`line ${i}$`)),
    );
  });

  it("starts each line with the local time and the level", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 11, 12, 56, 39, 655));

    Logger.info("connected", file);
    await settle(5_000);

    expect(await lines()).toEqual(["2026-11-11 12:56:39.655 [info] connected"]);
    expect(localTime()).toBe("2026-11-11 12:56:39.655");
  });

  it("writes the same line to the console and the file", async () => {
    Logger.info("connected", file);
    await settle(5_000);

    const [line] = await lines();
    expect(line).toMatch(
      /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} \[info\] connected$/,
    );
    expect(console.log).toHaveBeenCalledWith(line);
  });

  it("uses the console method of each level", () => {
    Logger.setDebug(true);
    Logger.debug("d");
    Logger.info("i");
    Logger.warn("w");
    Logger.error("e");

    expect(console.log).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("[warn] w"),
    );
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("[error] e"),
    );
  });

  it("writes debug lines only while debug is on", async () => {
    Logger.debug("hidden", file);
    Logger.setDebug(true);
    Logger.debug("shown", file);
    Logger.setDebug(false);
    Logger.debug("hidden again", file);
    await settle(5_000);

    expect(await lines()).toEqual([expect.stringMatching(/\[debug\] shown$/)]);
    expect(console.log).toHaveBeenCalledOnce();
  });

  it("starts a run in every file, printed once", async () => {
    const other = join(dir, "other.log");

    Logger.run("<System> Tokio 1.0.0", [file, other]);
    await settle(5_000);

    const [line] = await lines();
    expect(line).toMatch(/\[info\] <System> Tokio 1\.0\.0$/);
    expect(await lines(other)).toEqual([line]);
    expect(console.log).toHaveBeenCalledOnce();
    expect(console.log).toHaveBeenCalledWith(line);
  });

  it("indents the continuation lines of a message", async () => {
    Logger.error("first\nsecond", file);
    await settle(5_000);

    const written = await lines();
    expect(written[0]).toMatch(/\[error\] first$/);
    expect(written[1]).toBe("    second");
  });

  it("appends the stack trace and causes of an error", async () => {
    const error = new Error("save failed", { cause: new Error("disk full") });
    Logger.error("<System> Unable to save", file, error);
    await settle(5_000);

    const text = await readFile(file, "utf-8");
    expect(text).toMatch(
      /\[error\] <System> Unable to save\n {4}Error: save failed\n/,
    );
    expect(text).toMatch(/^ {8}at .+index\.test\.ts/m);
    expect(text).toContain("[cause]: Error: disk full");
    // Every line after the first is indented, so each entry still starts with a timestamp.
    expect(
      text
        .trimEnd()
        .split("\n")
        .slice(1)
        .every((l) => l.startsWith("    ")),
    ).toBe(true);
  });

  it("logs only the message for values that are not errors", async () => {
    Logger.error("failed", file, "timeout");
    await settle(5_000);

    expect(await lines()).toEqual([expect.stringMatching(/\[error\] failed$/)]);
  });

  it("reports a failing file once without throwing", async () => {
    const missing = join(dir, "missing", "test.log");

    Logger.info("a", missing);
    Logger.info("b", missing);
    await expect(settle(5_000)).resolves.toBeUndefined();

    const reports = vi
      .mocked(console.error)
      .mock.calls.filter(([msg]) => String(msg).startsWith("Logger:"));
    expect(reports).toHaveLength(1);
  });

  describe("rotation", () => {
    const backup = () => file.replace(/\.log$/, ".old.log");

    it("moves a log over 5 MB to its backup and starts a new one", async () => {
      await writeFile(backup(), "older backup\n");
      await writeFile(file, "old entry\n");
      await truncate(file, LIMIT + 1);

      Logger.info("new entry", file);
      await settle(5_000);

      expect(await lines()).toEqual([expect.stringMatching(/new entry$/)]);
      expect(await readFile(backup(), "utf-8")).toMatch(/^old entry\n/);
    });

    it("moves a log once when it crosses 5 MB, keeping every line in order", async () => {
      await writeFile(file, "");
      await truncate(file, LIMIT - 100);

      for (let i = 0; i < 10; i++) Logger.info(`line ${i}`, file);
      await settle(5_000);

      const backupText = await readFile(backup(), "utf-8");
      // A second move would have replaced the backup, padding and all
      expect(backupText.startsWith("\0")).toBe(true);
      const old = backupText
        .slice(backupText.lastIndexOf("\0") + 1)
        .trimEnd()
        .split("\n");
      const now = await lines();
      expect(old.length).toBeGreaterThan(0);
      expect(now.length).toBeGreaterThan(0);
      expect([...old, ...now].map((line) => line.split("] ")[1])).toEqual(
        Array.from({ length: 10 }, (_, i) => `line ${i}`),
      );
    });

    it("keeps writing to a big log it can't move", async () => {
      await writeFile(file, "old entry\n");
      await truncate(file, LIMIT + 1);
      // A folder in the backup's place fails the move on every system
      await mkdir(backup());
      await writeFile(join(backup(), "kept"), "");

      Logger.info("new entry", file);
      await settle(5_000);

      const text = await readFile(file, "utf-8");
      expect(text).toMatch(/^old entry\n/);
      expect(text).toMatch(/\[info\] new entry\n$/);
      expect(console.error).not.toHaveBeenCalled();
    });
  });

  describe("zip", () => {
    it("zips every log and backup once the writes still running are done", async () => {
      await writeFile(join(dir, "test.old.log"), "older\n");
      await writeFile(join(dir, "notes.txt"), "not a log\n");
      Logger.info("last line", file);

      const files = unzipSync(await Logger.zip(dir));

      expect(Object.keys(files).sort()).toEqual(["test.log", "test.old.log"]);
      expect(strFromU8(files["test.log"])).toMatch(/\[info\] last line\n$/);
      expect(strFromU8(files["test.old.log"])).toBe("older\n");
    });
  });
});
