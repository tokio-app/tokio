import "@/ui/styles/base.css";

import { LanguageProvider } from "@/ui/i18n";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SplashScreen } from ".";

// The splash window, shown while the main window loads hidden
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LanguageProvider>
      <SplashScreen />
    </LanguageProvider>
  </StrictMode>,
);
