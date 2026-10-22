import { TOKIO_EVENTS } from "@/common/types";
import { describe, expect, it, vi } from "vitest";
import { TokioEmitter } from "./emitter";

class Source extends TokioEmitter {
  public send() {
    this.emit(TOKIO_EVENTS.SUPER_FAN_BOX);
  }
}

describe("TokioEmitter", () => {
  it("calls a listener until it's removed with off", () => {
    const source = new Source();
    const listener = vi.fn();
    source.on(TOKIO_EVENTS.SUPER_FAN_BOX, listener);

    source.send();
    source.off(TOKIO_EVENTS.SUPER_FAN_BOX, listener);
    source.send();

    expect(listener).toHaveBeenCalledOnce();
  });

  it("keeps each instance's listeners apart", () => {
    const listener = vi.fn();
    new Source().on(TOKIO_EVENTS.SUPER_FAN_BOX, listener);

    new Source().send();

    expect(listener).not.toHaveBeenCalled();
  });
});
