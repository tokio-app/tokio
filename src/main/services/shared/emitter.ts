import { TOKIO_EVENTS, TokioEventMap } from "@/common/types";
import { EventEmitter } from "node:events";

// Live events, typed by TokioEventMap: anyone listens, the class emits.
export class TokioEmitter {
  // ES private, so a subclass can keep a field of its own by this name
  #events = new EventEmitter();

  public on<K extends TOKIO_EVENTS>(
    event: K,
    listener: (data: TokioEventMap[K]) => void,
  ): void {
    this.#events.on(event, listener);
  }

  public off<K extends TOKIO_EVENTS>(
    event: K,
    listener: (data: TokioEventMap[K]) => void,
  ): void {
    this.#events.off(event, listener);
  }

  protected emit<K extends TOKIO_EVENTS>(
    event: K,
    data?: TokioEventMap[K],
  ): void {
    this.#events.emit(event, data);
  }
}
