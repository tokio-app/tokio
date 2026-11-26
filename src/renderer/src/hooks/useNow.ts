import { useEffect, useState } from "react";

/**
 * `performance.now()`, updated every 250 ms while `running`. It starts at
 * `start`, when given, the moment a push came in.
 */
export function useNow(running: boolean, start?: number) {
  const [now, setNow] = useState(() => start ?? performance.now());

  useEffect(() => {
    if (!running) return undefined;
    const tick = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(tick);
  }, [running]);

  return now;
}
