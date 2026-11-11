import { AboutInfo, APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { Page } from "@/components";
import { useTour } from "@/context";
import { useIpcListener, useIpcRequest, useUpdateStatus } from "@/hooks";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AppSection } from "./sections/AppSection";
import { ComponentsSection } from "./sections/ComponentsSection";
import { LicenseModal } from "./sections/LicenseModal";
import { PackagesSection } from "./sections/PackagesSection";
import { ServicesSection } from "./sections/ServicesSection";

export function About() {
  const [about, setAbout] = useState<AboutInfo | null>(null);
  const [failed, setFailed] = useState(false);
  // Document or package whose license is shown
  const [viewing, setViewing] = useState<string | null>(null);
  const update = useUpdateStatus();
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string>();
  const [connected, setConnected] = useState(false);
  const navigate = useNavigate();
  const startTour = useTour();

  useIpcRequest(APP_EVENTS.GET_ABOUT);
  useIpcRequest(APP_EVENTS.IS_CONNECTED);

  useIpcListener(APP_EVENTS_RESPONSE.CONNECTED, (res) => {
    if (res) setConnected(res.success);
  });

  useIpcListener(APP_EVENTS_RESPONSE.CHECK_UPDATES, (res) => {
    setChecking(false);
    setCheckError(res?.success ? undefined : res?.error?.message);
  });

  useIpcListener(APP_EVENTS_RESPONSE.GET_ABOUT, (res) => {
    if (!res) return;
    setAbout(res.data ?? null);
    setFailed(!res.success);
  });

  return (
    <>
      {viewing && (
        <LicenseModal
          id={viewing}
          onClose={() => setViewing(null)}
          onView={setViewing}
        />
      )}

      <Page>
        <AppSection
          versions={about?.versions}
          update={update}
          checking={checking}
          checkError={checkError}
          connected={connected}
          onCheck={() => {
            setChecking(true);
            setCheckError(undefined);
            window.api.emit(APP_EVENTS.CHECK_UPDATES);
          }}
          onView={setViewing}
          onTour={() => {
            // Its last steps are on Home
            void navigate({ to: "/" });
            startTour();
          }}
        />
        <ComponentsSection onView={setViewing} />
        <PackagesSection
          packages={about?.packages}
          failed={failed}
          onView={setViewing}
        />
        <ServicesSection />
      </Page>
    </>
  );
}
