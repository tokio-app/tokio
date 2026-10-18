import "@/ui/styles/base.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SplashScreen } from ".";

// The splash window, shown while the main window loads hidden
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SplashScreen />
  </StrictMode>,
);
