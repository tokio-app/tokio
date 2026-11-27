import "@/ui/styles/base.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

// React's development build records a performance.measure each time a
// component mounts or unmounts (its Performance tracks), and Chromium keeps
// every one: a busy LIVE's feed piled up hundreds of MB in yarn dev. A
// DevTools recording takes them as they're made, so clearing loses nothing.
const CLEAR_MEASURES_MS = 10_000;
if (import.meta.env.DEV) {
  setInterval(() => performance.clearMeasures(), CLEAR_MEASURES_MS);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
