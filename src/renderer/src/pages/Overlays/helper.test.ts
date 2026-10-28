import { APP_EVENTS, TokioPayload } from "@/common/types";
import { sent } from "@test/ipc";
import { afterEach, describe, expect, it, vi } from "vitest";
import { postToOverlay, postToPreviews, updatesHint } from "./helper";

const payload: TokioPayload = { type: "tokio:config", data: { title: "Goal" } };

// A preview iframe, with its postMessage recorded
function preview(name: string) {
  const iframe = document.createElement("iframe");
  iframe.name = name;
  document.body.append(iframe);
  return vi.spyOn(iframe.contentWindow!, "postMessage");
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("updatesHint", () => {
  it("counts the updates, and says nothing without any", () => {
    expect(updatesHint(0, "en")).toBeUndefined();
    expect(updatesHint(1, "en")).toBe("1 update available");
    expect(updatesHint(3, "en")).toBe("3 updates available");
  });
});

describe("postToPreviews", () => {
  it("posts to every preview of the overlay", () => {
    const card = preview("TOKIO_APP-gift-jar");
    const modal = preview("TOKIO_APP-gift-jar");
    const other = preview("TOKIO_APP-top-likes");

    postToPreviews("gift-jar", payload);

    const message = { action: "TOKIO_PREVIEW", payload };
    expect(card).toHaveBeenCalledWith(message, "*");
    expect(modal).toHaveBeenCalledWith(message, "*");
    expect(other).not.toHaveBeenCalled();
  });

  it("finds overlays whose id needs escaping", () => {
    const quoted = preview('TOKIO_APP-my "jar"');

    postToPreviews('my "jar"', payload);

    expect(quoted).toHaveBeenCalledOnce();
  });

  it("warns when the overlay has no preview", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    postToPreviews("gift-jar", payload);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("gift-jar"));
  });
});

describe("postToOverlay", () => {
  it("posts to the previews and sends to the live overlay", () => {
    const card = preview("TOKIO_APP-gift-jar");

    postToOverlay("gift-jar", payload);

    expect(card).toHaveBeenCalledOnce();
    expect(sent(APP_EVENTS.SEND_OVERLAY_DATA)).toEqual([
      { id: "gift-jar", payload },
    ]);
  });
});
