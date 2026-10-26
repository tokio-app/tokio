import { CatalogOverlay } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE, OverlayApp } from "@/common/types";
import { catalogState, CatalogState } from "@/common/util";
import {
  Btn,
  EmptyState,
  RemoveOverlayModal,
  Section,
  Spinner,
} from "@/components";
import { useIpcListener, useIpcRequest } from "@/hooks";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { FiCheck, FiTrash2 } from "react-icons/fi";
import { LuArrowLeft, LuDownload, LuRefreshCw } from "react-icons/lu";
import { VscPackage } from "react-icons/vsc";
import styles from "../officialoverlays.module.css";

interface Props {
  // The installed overlays, to tell which official ones are
  overlays: OverlayApp[];
}

/**
 * The official overlays, to install, update and remove. Main replies to both
 * with the new overlay list, which the page passes back down.
 */
export function CatalogSection({ overlays }: Props) {
  const navigate = useNavigate();
  // Null while it loads
  const [catalog, setCatalog] = useState<CatalogOverlay[] | null>(null);
  // Why it couldn't be loaded
  const [error, setError] = useState<string | null>(null);
  // Overlays being installed or updated
  const [installing, setInstalling] = useState<string[]>([]);
  // Overlay waiting for the user to confirm its removal
  const [removing, setRemoving] = useState<CatalogOverlay | null>(null);

  useIpcRequest(APP_EVENTS.GET_OVERLAY_CATALOG);

  useIpcListener(APP_EVENTS_RESPONSE.GET_OVERLAY_CATALOG, (res) => {
    if (res?.success) {
      setCatalog(res.data!);
      setError(null);
    } else if (!catalog) {
      // A late failure (another page's request) leaves the shown catalog.
      setError(res?.error?.message ?? "Unable to load the official overlays.");
    }
  });

  // Main reports a failure itself.
  useIpcListener(APP_EVENTS_RESPONSE.INSTALL_OVERLAY, (res) => {
    if (res) setInstalling((ids) => ids.filter((id) => id !== res.id));
  });

  const install = (id: string) => {
    setInstalling((ids) => [...ids, id]);
    window.api.emit(APP_EVENTS.INSTALL_OVERLAY, { id });
  };

  const retry = () => {
    setError(null);
    window.api.emit(APP_EVENTS.GET_OVERLAY_CATALOG);
  };

  return (
    <>
      {removing && (
        <RemoveOverlayModal item={removing} onClose={() => setRemoving(null)} />
      )}

      <Section
        icon={
          <Btn
            variant="icon"
            title="Back to Overlays"
            className={styles.back}
            onClick={() => navigate({ to: "/overlays" })}
          >
            <LuArrowLeft size={22} />
          </Btn>
        }
        title="Official Overlays"
        description="Made for Tokio. Updates keep your settings."
        divider
        actions={error && <Btn onClick={retry}>Try again</Btn>}
      >
        <CatalogList
          catalog={catalog}
          error={error}
          overlays={overlays}
          installing={installing}
          onInstall={install}
          onRemove={setRemoving}
        />
      </Section>
    </>
  );
}

interface ListProps {
  catalog: CatalogOverlay[] | null;
  error: string | null;
  overlays: OverlayApp[];
  installing: string[];
  onInstall: (id: string) => void;
  onRemove: (entry: CatalogOverlay) => void;
}

// The official overlays, or why they aren't shown
function CatalogList({
  catalog,
  error,
  overlays,
  installing,
  onInstall,
  onRemove,
}: ListProps) {
  if (error) return <EmptyState>{error}</EmptyState>;
  if (!catalog) {
    return (
      <div className={styles.loading}>
        <Spinner size={32} />
      </div>
    );
  }
  if (catalog.length === 0) {
    return <EmptyState>No official overlays yet.</EmptyState>;
  }

  return (
    <div className={styles.grid}>
      {catalog.map((entry) => (
        <CatalogCard
          key={entry.id}
          entry={entry}
          state={catalogState(entry, overlays)}
          busy={installing.includes(entry.id)}
          onInstall={() => onInstall(entry.id)}
          onRemove={() => onRemove(entry)}
        />
      ))}
    </div>
  );
}

interface CardProps {
  entry: CatalogOverlay;
  state: CatalogState;
  busy: boolean;
  onInstall: () => void;
  onRemove: () => void;
}

function CatalogCard({ entry, state, busy, onInstall, onRemove }: CardProps) {
  // The preview can't load offline, the placeholder shows instead
  const [broken, setBroken] = useState(false);

  return (
    <div className={styles.card}>
      <div className={styles.preview}>
        {entry.preview && !broken ? (
          <img
            src={entry.preview}
            alt={`Preview of ${entry.name}`}
            loading="lazy"
            onError={() => setBroken(true)}
          />
        ) : (
          <VscPackage size={48} />
        )}
      </div>

      <div className={styles.header}>
        <div className={styles.info}>
          <h3 className={styles.name} title={entry.name}>
            {entry.name}
          </h3>
          <span className={styles.version}>
            <VscPackage size={14} />
            {entry.version}
          </span>
        </div>
        <CatalogActions
          state={state}
          busy={busy}
          onInstall={onInstall}
          onRemove={onRemove}
        />
      </div>

      <p className={styles.description}>{entry.description}</p>
    </div>
  );
}

// Install or update it, or show it's installed. Installed ones can be removed.
function CatalogActions({
  state,
  busy,
  onInstall,
  onRemove,
}: Omit<CardProps, "entry">) {
  return (
    <div className={styles.actions}>
      {state === "installed" && (
        <span className={styles.installed}>
          <FiCheck size={16} />
          Installed
        </span>
      )}
      {state === "update" && (
        <Btn loading={busy} onClick={onInstall}>
          <LuRefreshCw size={16} />
          Update
        </Btn>
      )}
      {state === "install" && (
        <Btn loading={busy} onClick={onInstall}>
          <LuDownload size={16} />
          Install
        </Btn>
      )}
      {state !== "install" && (
        <Btn variant="icon" title="Remove" disabled={busy} onClick={onRemove}>
          <FiTrash2 size={20} />
        </Btn>
      )}
    </div>
  );
}
