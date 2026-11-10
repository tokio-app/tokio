import { APP_EVENTS, APP_EVENTS_RESPONSE, CameraCapture } from "@/common/types";
import { startCapture } from "@/helper/camera";
import { useEffect, useRef } from "react";
import { useIpcListener } from "./useIpcListener";
import { useIpcRequest } from "./useIpcRequest";

const same = (a: CameraCapture, b: CameraCapture) =>
  a.device === b.device && a.label === b.label && a.quality === b.quality;

/**
 * Captures the cameras main says pages show, for Overlay Studio's camera
 * elements, while the window is open: main streams their frames to the
 * pages.
 */
export function useCameraCapture() {
  const running = useRef(
    new Map<string, { capture: CameraCapture; stop: () => void }>(),
  );

  useIpcRequest(APP_EVENTS.GET_CAMERAS);

  useIpcListener(APP_EVENTS_RESPONSE.CAMERAS, (res) => {
    if (!res) return;
    const wanted = new Map(res.captures.map((c) => [c.id, c]));
    for (const [id, { capture, stop }] of running.current) {
      const next = wanted.get(id);
      if (next && same(capture, next)) continue;
      stop();
      running.current.delete(id);
    }
    for (const [id, capture] of wanted) {
      if (running.current.has(id)) continue;
      running.current.set(id, { capture, stop: startCapture(capture) });
    }
  });

  useEffect(() => {
    const captures = running.current;
    return () => {
      for (const { stop } of captures.values()) stop();
      captures.clear();
    };
  }, []);
}
