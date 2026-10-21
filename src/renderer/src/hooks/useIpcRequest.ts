import { APP_EVENTS } from "@/common/types";
import { useEffect, useRef } from "react";

/**
 * Sends a request to the main process once, when the component mounts.
 * StrictMode re-runs effects, so a ref keeps it from being sent twice.
 */
export function useIpcRequest(event: APP_EVENTS) {
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    window.api.emit(event);
  }, []);
}
