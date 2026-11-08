import Logger from "@/logger";
import { exec } from "@vscode/sudo-prompt";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { URLManagerService } from "./index";

// Never touch the real hosts file or ask for admin rights.
const hosts = vi.hoisted(() => ({ path: "" }));
vi.mock("@/config", async (importOriginal) => {
  const { default: config } = await importOriginal<typeof import("@/config")>();
  return {
    default: {
      ...config,
      CMD: {
        ...config.CMD,
        get HOST() {
          return [hosts.path];
        },
      },
    },
  };
});
vi.mock("@vscode/sudo-prompt", () => ({ exec: vi.fn() }));

const ENTRY = "127.0.0.1 tokio-app.local";
const ENTRY6 = "::1 tokio-app.local";

// Runs the admin prompt; `write` stands in for the elevated echo commands.
const elevated = (error?: Error, write = true) =>
  vi.mocked(exec).mockImplementation((_cmd, _options, callback) => {
    const done = () => callback?.(error);
    if (error || !write) done();
    else void appendFile(hosts.path, `\n${ENTRY}\n`).then(done);
  });

describe("URLManagerService", () => {
  let dir: string;
  let service: URLManagerService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tokio-test-"));
    hosts.path = join(dir, "hosts");
    service = new URLManagerService();
    vi.mocked(exec).mockReset();
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  describe("installAppFQDN", () => {
    it("does nothing when the hostname is already there", async () => {
      await writeFile(hosts.path, `${ENTRY}\n`);

      expect(await service.installAppFQDN()).toBe(true);
      expect(exec).not.toHaveBeenCalled();
    });

    it("accepts tabs, extra names and any letter case", async () => {
      await writeFile(
        hosts.path,
        "127.0.0.1\tlocalhost  TOKIO-APP.local # Tokio\r\n",
      );

      expect(await service.installAppFQDN()).toBe(true);
      expect(exec).not.toHaveBeenCalled();
    });

    it.each([
      ["a commented-out entry", `# ${ENTRY}`],
      ["only the IPv6 entry", ENTRY6],
      ["another IP", "0.0.0.0 tokio-app.local"],
      ["a look-alike name", "127.0.0.1 tokio-app.localhost"],
    ])("adds the hostname over %s", async (_, line) => {
      await writeFile(hosts.path, `${line}\n`);
      elevated();

      expect(await service.installAppFQDN()).toBe(true);
      expect(exec).toHaveBeenCalledOnce();
    });

    it("appends the hostname block with admin rights", async () => {
      await writeFile(hosts.path, "127.0.0.1 localhost\n");
      elevated();

      expect(await service.installAppFQDN()).toBe(true);

      expect(exec).toHaveBeenCalledOnce();
      expect(exec).toHaveBeenCalledWith(
        [
          "(",
          "echo.",
          "echo ## Tokio App Hostname - Start ##",
          `echo ${ENTRY}`,
          `echo ${ENTRY6}`,
          "echo ## Tokio App Hostname - End ##",
          `)>> ${hosts.path}`,
        ].join("\n"),
        { name: "Tokio" },
        expect.any(Function),
      );
    });

    it("prompts once for calls made while the prompt is open", async () => {
      await writeFile(hosts.path, "");
      elevated();

      const results = await Promise.all([
        service.installAppFQDN(),
        service.installAppFQDN(),
      ]);

      expect(results).toEqual([true, true]);
      expect(exec).toHaveBeenCalledOnce();
    });

    it("fails when the admin prompt is refused", async () => {
      await writeFile(hosts.path, "");
      elevated(new Error("User did not grant permission."));
      const error = vi.spyOn(Logger, "error");

      expect(await service.installAppFQDN()).toBe(false);
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining("User did not grant permission."),
        undefined,
        expect.any(Error),
      );
    });

    it("fails when the hosts file is unchanged after the prompt", async () => {
      await writeFile(hosts.path, "");
      elevated(undefined, false);
      const error = vi.spyOn(Logger, "error");

      expect(await service.installAppFQDN()).toBe(false);
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining("Hosts file was not updated"),
        undefined,
      );
    });

    it("fails without prompting when the hosts file can't be read", async () => {
      expect(await service.installAppFQDN()).toBe(false);
      expect(exec).not.toHaveBeenCalled();
    });

    describe("on Linux and macOS", () => {
      const append = () =>
        `(${[
          "echo",
          "echo '## Tokio App Hostname - Start ##'",
          `echo '${ENTRY}'`,
          `echo '${ENTRY6}'`,
          "echo '## Tokio App Hostname - End ##'",
        ].join(" && ")}) >> ${hosts.path}`;

      it("appends the block with a shell command on Linux", async () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("linux");
        await writeFile(hosts.path, "127.0.0.1 localhost\n");
        elevated();

        expect(await service.installAppFQDN()).toBe(true);
        expect(exec).toHaveBeenCalledWith(
          append(),
          { name: "Tokio" },
          expect.any(Function),
        );
      });

      it("also flushes the DNS cache on macOS", async () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
        await writeFile(hosts.path, "127.0.0.1 localhost\n");
        elevated();

        expect(await service.installAppFQDN()).toBe(true);
        expect(exec).toHaveBeenCalledWith(
          `${append()} && (dscacheutil -flushcache; killall -HUP mDNSResponder; true)`,
          { name: "Tokio" },
          expect.any(Function),
        );
      });

      it("keeps the command safe inside bash -c double quotes", async () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("linux");
        await writeFile(hosts.path, "");
        elevated();

        await service.installAppFQDN();

        expect(vi.mocked(exec).mock.calls[0][0]).not.toMatch(/[$`"\n]/);
      });
    });

    it("fails without prompting on other platforms", async () => {
      vi.spyOn(process, "platform", "get").mockReturnValue("freebsd");
      await writeFile(hosts.path, "");

      expect(await service.installAppFQDN()).toBe(false);
      expect(exec).not.toHaveBeenCalled();
    });
  });
});
