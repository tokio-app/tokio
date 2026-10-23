import {
  getOverlayConfig,
  OverlayConfig,
  OverlayConfigSchema,
  OverlayMetadata,
  OverlayMetaSchema,
} from "@/common/schemas";
import { CustomGift, OverlayConfigRedux } from "@/common/types";
import { SERVER_PORT } from "@/common/util";
import { writeFileAtomic } from "@/helper/fs";
import { YAMLManagerService } from "@/services/yaml";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const SCRIPT_REGEX = /<script id="tokio-setup">[\s\S]*?<\/script>/i;

// Imported overlays are named by a random UUID, official ones by their id in
// the catalog.
const IMPORTED_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Part of the setup block. OBS on another computer opens overlays at this
 * PC's address, where the overlay SDK's socket to localhost would reach the
 * wrong computer, so sockets to localhost on the server port go to the
 * address the page came from. Previews and pages opened on this PC are left
 * alone.
 */
export const REMOTE_SOCKET = `(() => {
  const loopback = ["localhost", "127.0.0.1", "[::1]"];
  if (location.port !== "${SERVER_PORT}" || loopback.includes(location.hostname)) return;
  const Native = window.WebSocket;
  window.WebSocket = class WebSocket extends Native {
    constructor(url, ...rest) {
      let target = url;
      try {
        const parsed = new URL(url);
        if (parsed.port === "${SERVER_PORT}" && loopback.includes(parsed.hostname)) {
          parsed.host = location.host;
          target = parsed.href;
        }
      } catch {}
      super(target, ...rest);
    }
  };
})();`;

// Where Tokio writes the overlay's ID, and its settings when it has them.
export const hasSetupBlock = (html: string) => SCRIPT_REGEX.test(html);

/**
 * Overlays installed in the overlays folder, each in a folder named by its id.
 * Lets a rebuilt store get its overlay list back. Folders starting with a dot
 * are installs in progress.
 */
export async function findOverlays(
  folder: string,
  yaml: YAMLManagerService,
): Promise<(OverlayMetadata & { id: string })[]> {
  const entries = await readdir(folder, { withFileTypes: true }).catch(
    () => [],
  );
  const overlays: (OverlayMetadata & { id: string })[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const external = IMPORTED_ID.test(entry.name);
    const res = await processOverlay(join(folder, entry.name), yaml, external);
    if (res.success && res.data) {
      overlays.push({ ...res.data.info, id: entry.name, external });
    }
  }
  return overlays;
}

export async function processOverlay(
  basedir: string,
  yaml: YAMLManagerService,
  force_external: boolean,
): Promise<{
  success: boolean;
  data?: {
    info: OverlayMetadata;
    config?: OverlayConfig;
    htmlContent: string;
  };
  paths?: {
    config: string;
    html: string;
    info: string;
  };
}> {
  try {
    const files = await readdir(basedir);

    let configPath = "";
    let infoPath = "";
    let htmlPath = "";

    for (const file of files) {
      if (file === "config.yaml" || file === "config.yml")
        configPath = join(basedir, file);
      else if (file === "info.yaml" || file === "info.yml")
        infoPath = join(basedir, file);
      else if (file === "index.html") htmlPath = join(basedir, file);
    }

    if (!infoPath || !htmlPath) {
      return { success: false };
    }

    const [info_data, htmlContent] = await Promise.all([
      yaml.loadFile(infoPath, OverlayMetaSchema),
      readFile(htmlPath, "utf-8"),
    ]);

    if (!info_data) {
      return { success: false };
    }

    let config_data: OverlayConfig | undefined = undefined;

    if (info_data.config) {
      if (!configPath) {
        return { success: false };
      }

      config_data =
        (await yaml.loadFile(configPath, OverlayConfigSchema)) ?? undefined;

      if (!config_data) {
        return { success: false };
      }

      if (!htmlContent || !hasSetupBlock(htmlContent)) {
        return { success: false };
      }
    }

    if (force_external) {
      info_data.external = true;
    }

    return {
      success: true,
      data: {
        info: info_data,
        config: config_data,
        htmlContent,
      },
      paths: {
        config: configPath,
        html: htmlPath,
        info: infoPath,
      },
    };
  } catch {
    return { success: false };
  }
}

export async function processHTML(
  id: string,
  html: string,
  dir: string,
  config?: OverlayConfig,
  gifts?: CustomGift[] | null,
): Promise<{
  success: boolean;
  parsed?: OverlayConfigRedux;
}> {
  try {
    const htmlPath = join(dir, "index.html");
    const overlay_config = config ? getOverlayConfig(config, gifts) : undefined;
    // Overlays imported before the block was required may not have it.
    if (!hasSetupBlock(html)) {
      return {
        success: true,
        parsed: overlay_config,
      };
    }

    let setup = `window.__OVERLAY_ID__ = "${id}";`;
    if (overlay_config) {
      const safeJson = JSON.stringify(overlay_config).replace(/</g, "\\u003c");
      setup = `window.__OVERLAY_CONFIG__ = ${safeJson}; ${setup}`;
    }
    const newScriptBlock = `<script id="tokio-setup"> ${setup} ${REMOTE_SOCKET} </script>`;

    // A function, so $& or $$ in a setting stay as typed.
    const finalHtml = html.replace(SCRIPT_REGEX, () => newScriptBlock);

    // `html` is the file as read, so most starts write nothing.
    if (finalHtml !== html) await writeFileAtomic(htmlPath, finalHtml);

    return {
      success: true,
      parsed: overlay_config,
    };
  } catch {
    return {
      success: false,
    };
  }
}
