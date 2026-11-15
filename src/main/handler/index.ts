import { APP_EVENTS, AppEventsMap } from "@/common/types";
import { invokeEvent, runEvent, Stack } from "@/helper/events";
import { track } from "@/helper/quit";
import { EventItem, Invoke } from "@/types";
import { AppHandler } from "./app";

export default class Handler extends AppHandler {
  // The stack init got, by event, for invoke
  private _events = new Map<APP_EVENTS, EventItem<any>>();

  private addEvent(item: EventItem<APP_EVENTS>) {
    this.ipcMain.on(item.event, (ev, params: AppEventsMap[APP_EVENTS]) => {
      // A quit waits for it, so a save sent as the window closes still lands.
      void track(runEvent(item, this, ev, params));
    });
  }

  public async init(events: Stack) {
    await this.initApp();

    for (const item of events.getEvents()) {
      this._events.set(item.event, item);
      this.addEvent(item);
    }
  }

  // A field, so it replaces the one AppHandler copies from its deps, and
  // stays bound when handed to a service as a callback
  public readonly invoke: Invoke = (event, data) =>
    invokeEvent(this._events, this, event, data);
}
