import { join } from "path";

const SYSTEM_ROOT = process.env["SystemRoot"] || "C:\\Windows";
const POWERSHELL_PATH = join("WindowsPowerShell", "v1.0", "powershell.exe");

export default {
  // NOTE: 32-bit PowerShell first, 32-bit only voices (e.g. Loquendo) are invisible to 64-bit processes.
  POWERSHELL_PATHS: [
    join(SYSTEM_ROOT, "SysWOW64", POWERSHELL_PATH),
    join(SYSTEM_ROOT, "System32", POWERSHELL_PATH),
  ],
  DEFAULT_RATE: 0,
  DEFAULT_VOLUME: 100,
  REQUEST_TIMEOUT_MS: 15000,
  // Until a new host first answers, its requests also wait for PowerShell and the speech engines to load.
  START_TIMEOUT_MS: 30_000,
  // The PowerShell host exits after this long without requests, the next one respawns it.
  IDLE_TIMEOUT_MS: 5 * 60_000,
};
