import { StudioOverlay } from "@/common/schemas";
import Logger from "@/logger";
import { app, BrowserWindow, fakeImage } from "@test/electron";
import { createHandler } from "@test/handler";
import { mcpClient } from "@test/mcp";
import { describe, expect, it, vi } from "vitest";

const ID = "6f1d2c1e-4b5a-4c3d-9e8f-0a1b2c3d4e5f";

const OVERLAY: StudioOverlay = {
  id: ID,
  name: "Main",
  size: "portrait",
  rulers: false,
  guides: { x: [], y: [], locked: false },
  counters: [],
  items: [],
};

const setup = () =>
  createHandler({
    storeManagerService: { getStudio: () => [OVERLAY] },
    overlayService: {
      getGifts: async () => [],
      getCustomGifts: async () => [],
      getOverlays: () => [],
    },
    serverService: { getPort: () => 37891 },
    pathManagerService: { files: { logs: { system: "system.log" } } },
  }).handler;

// Sets up each preview window's page before it loads
const onPage = (
  setup: (page: InstanceType<typeof BrowserWindow>["webContents"]) => void,
) =>
  app.on(
    "browser-window-created",
    (_: unknown, win: InstanceType<typeof BrowserWindow>) => {
      if (win.options.webPreferences?.partition === "studio-preview") {
        setup(win.webContents);
      }
    },
  );

describe("studio MCP tools", () => {
  it("returns the preview as an image, with its size", async () => {
    onPage((page) => {
      page.executeJavaScript.mockResolvedValue(1);
      page.capturePage.mockResolvedValue(
        fakeImage({ width: 540, height: 960 }),
      );
    });
    const { client } = await mcpClient(setup());

    const res = await client.callTool({
      name: "preview_studio_overlay",
      arguments: { id: ID },
    });

    expect(res.isError).toBeFalsy();
    expect(res.content).toEqual([
      {
        type: "image",
        data: Buffer.from("png 540x960").toString("base64"),
        mimeType: "image/png",
      },
      {
        type: "text",
        text: JSON.stringify({
          id: ID,
          width: 540,
          height: 960,
          scale: 0.5,
          failedToLoad: 1,
        }),
      },
    ]);
  });

  it("is read-only but reaches the web", async () => {
    const { client } = await mcpClient(setup());

    const { tools } = await client.listTools();

    expect(
      tools.find((t) => t.name === "preview_studio_overlay")?.annotations,
    ).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  });

  it("refuses an unknown id and a scale out of range", async () => {
    const { call } = await mcpClient(setup());

    expect(await call("preview_studio_overlay", { id: "nope" })).toEqual({
      isError: true,
      text: "No studio overlay nope.",
      value: "No studio overlay nope.",
    });
    const tiny = await call("preview_studio_overlay", { id: ID, scale: 0.1 });
    expect(tiny.isError).toBe(true);
  });

  it("fails with a plain message, logged once, when the capture fails", async () => {
    onPage((page) =>
      page.executeJavaScript.mockRejectedValue(new Error("page crashed")),
    );
    const error = vi.spyOn(Logger, "error");
    const { call } = await mcpClient(setup());

    const res = await call("preview_studio_overlay", { id: ID });

    expect(res).toMatchObject({
      isError: true,
      text: "Tokio couldn't run preview_studio_overlay: page crashed",
    });
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0][0]).toMatch(/^<MCP> preview_studio_overlay/);
  });
});
