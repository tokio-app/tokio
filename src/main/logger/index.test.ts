import { settle } from "@/helper/quit";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Logger from "./index";

describe("Logger", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tokio-test-"));
    file = join(dir, "test.log");
  });

  afterEach(async () => {
    await settle(5_000);
    await rm(dir, { recursive: true, force: true });
  });

  const lines = async () =>
    (await readFile(file, "utf-8")).trimEnd().split("\n");

  it("writes a burst of lines in call order", async () => {
    for (let i = 0; i < 50; i++) Logger.info(`line ${i}`, file);
    await settle(5_000);

    const written = await lines();
    expect(written).toHaveLength(50);
    written.forEach((line, i) =>
      expect(line).toMatch(new RegExp(`line ${i}$`)),
    );
  });

  it("writes the same line to the console and the file", async () => {
    Logger.success("connected", file);
    await settle(5_000);

    const [line] = await lines();
    expect(line).toMatch(/^\S+Z -- \[SUCCESS\]: connected$/);
    expect(console.log).toHaveBeenCalledWith(line);
  });

  it("uses the console method of each level", () => {
    Logger.info("i");
    Logger.success("s");
    Logger.warn("w");
    Logger.error("e");

    expect(console.log).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("[WARN]: w"),
    );
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("[ERROR]: e"),
    );
  });

  it("indents the continuation lines of a message", async () => {
    Logger.error("first\nsecond", file);
    await settle(5_000);

    const written = await lines();
    expect(written[0]).toMatch(/\[ERROR\]: first$/);
    expect(written[1]).toBe("    second");
  });

  it("appends the stack trace and causes of an error", async () => {
    const error = new Error("save failed", { cause: new Error("disk full") });
    Logger.error("<System> Unable to save", file, error);
    await settle(5_000);

    const text = await readFile(file, "utf-8");
    expect(text).toMatch(
      /\[ERROR\]: <System> Unable to save\n {4}Error: save failed\n/,
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

    expect(await lines()).toEqual([
      expect.stringMatching(/\[ERROR\]: failed$/),
    ]);
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
});
