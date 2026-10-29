import { describe, expect, it, vi } from "vitest";
import { releaseOnUnmount } from "./media";

const SOUND = "tokio-media:///sounds/horn.mp3";

// A library sound's player, in the page
const player = () => {
  const el = document.createElement("audio");
  el.src = SOUND;
  document.body.append(el);
  return el;
};

describe("releaseOnUnmount", () => {
  it("drops the source of a player removed from the page", async () => {
    const el = player();
    const load = vi.spyOn(el, "load");
    const cleanup = releaseOnUnmount(el);

    el.remove();
    cleanup();
    await Promise.resolve();

    expect(el).not.toHaveAttribute("src");
    expect(load).toHaveBeenCalledOnce();
  });

  it("keeps a player still in the page, as StrictMode attaches it again", async () => {
    const el = player();

    releaseOnUnmount(el)();
    await Promise.resolve();

    expect(el).toHaveAttribute("src", SOUND);
    el.remove();
  });
});
