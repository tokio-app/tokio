import Logger from "@/logger";
import { isAbsolute } from "node:path";
import { beforeEach, vi } from "vitest";
import { resetElectron } from "./main/electron";

// The real module only works inside Electron, see test/main/electron.ts.
vi.mock("electron", () => import("./main/electron"));

// Tests name log files without a folder ("system.log"), which would end up
// in the repository. Only files in a temp folder are written.
function keepLogsInTempFolders(logger: any) {
  const write = logger.write;
  vi.spyOn(logger, "write").mockImplementation((file, line) => {
    if (typeof file === "string" && isAbsolute(file)) {
      write.call(logger, file, line);
    }
  });
}

// Logger and the queues write to the console, keep the test output readable.
beforeEach(() => {
  resetElectron();
  keepLogsInTempFolders(Logger);
  for (const method of ["log", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
});
