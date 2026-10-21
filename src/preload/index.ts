import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  AppEventsMap,
  AppEventsResponseMap,
} from "@/common/types";
import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";

type Callback = (event: IpcRendererEvent, ...args: any[]) => void;

const api = {
  on: <T extends APP_EVENTS_RESPONSE>(
    event: T,
    callback: (data: AppEventsResponseMap[T]) => void,
  ) => {
    const cb: Callback = (_, data: AppEventsResponseMap[T]) => callback(data);
    ipcRenderer.on(event, cb);
    return () => {
      ipcRenderer.off(event, cb);
    };
  },
  emit: <T extends APP_EVENTS>(event: T, data: AppEventsMap[T]) =>
    ipcRenderer.send(event, data),
};

try {
  contextBridge.exposeInMainWorld("api", api);
} catch (error) {
  console.error(error);
}
