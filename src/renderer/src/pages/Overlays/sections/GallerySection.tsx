import { CatalogOverlay } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE, OverlayApp } from "@/common/types";
import { countUpdates } from "@/common/util";
import {
  Btn,
  EmptyState,
  OverlayView,
  SearchToggle,
  Section,
} from "@/components";
import { useIpcListener, useIpcRequest } from "@/hooks";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { LuPackageSearch } from "react-icons/lu";
import { updatesHint } from "../helper";
import styles from "../overlays.module.css";

interface Props {
  overlays: OverlayApp[];
  onTest: (id: string) => void;
  onCustomize: (id: string) => void;
}

export function GallerySection({ overlays, onTest, onCustomize }: Props) {
  const [search, setSearch] = useState("");

  const shown = useMemo(() => {
    const needle = search.toLowerCase();
    return overlays.filter((o) => o.name.toLowerCase().includes(needle));
  }, [overlays, search]);

  return (
    <Section
      title="Overlay Gallery"
      description="Enhance your stream layout with overlays."
      divider
      actions={
        <>
          <SearchToggle
            placeholder="Search overlays..."
            value={search}
            onChange={setSearch}
          />
          <OfficialButton overlays={overlays} />
        </>
      }
    >
      {shown.length > 0 ? (
        <div className={styles.gallery}>
          {shown.map((overlay) => (
            <OverlayView
              // An update reloads the preview
              key={`${overlay.id}@${overlay.version}`}
              overlay={overlay}
              onTest={onTest}
              onCustomize={onCustomize}
            />
          ))}
        </div>
      ) : (
        <EmptyState>
          {overlays.length > 0
            ? "No overlays found."
            : "No overlays yet. Install an official one, or import your own in Settings."}
        </EmptyState>
      )}
    </Section>
  );
}

// Opens the official overlays, with a dot while updates are waiting
function OfficialButton({ overlays }: { overlays: OverlayApp[] }) {
  const navigate = useNavigate();
  // Only to count the updates
  const [catalog, setCatalog] = useState<CatalogOverlay[]>([]);
  const hint = updatesHint(countUpdates(catalog, overlays));

  useIpcRequest(APP_EVENTS.GET_OVERLAY_CATALOG);

  // Without the catalog, offline for example, there's just no dot. Official
  // Overlays shows why.
  useIpcListener(APP_EVENTS_RESPONSE.GET_OVERLAY_CATALOG, (res) => {
    if (res?.success) setCatalog(res.data!);
  });

  return (
    <Btn
      title={hint}
      aria-label={hint && `Official Overlays, ${hint}`}
      onClick={() => navigate({ to: "/overlays/official" })}
    >
      <LuPackageSearch size={18} />
      Official Overlays
      {hint && <span className={styles.update_dot} />}
    </Btn>
  );
}
