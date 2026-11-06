import {
  Alert,
  Profile,
  STUDIO_MAX_LAYERS,
  StudioLayer,
  StudioLayerKind,
  StudioOverlay,
  StudioSource,
} from "@/common/schemas";
import { Stage } from "@/common/studio/stage";
import { APP_EVENTS, APP_EVENTS_RESPONSE, OverlayApp } from "@/common/types";
import {
  alertName,
  gameOverlayRows,
  getAlertOverlayURL,
  getMediaPreviewURL,
  getMinecraftOverlayURL,
  getOverlayURL,
  getPicturePreviewURL,
  getStudioOverlayURL,
  mediaKind,
  newStudioLayer,
  studioView,
  TIMER_PATH,
} from "@/common/util";
import {
  BackButton,
  Btn,
  CopyButton,
  EmptyState,
  MediaPicker,
  Page,
  Section,
  SelectOption,
  Spinner,
} from "@/components";
import {
  flushSettings,
  useAutosave,
  useIpcListener,
  useIpcRequest,
} from "@/hooks";
import { useTriggerChoices } from "@/pages/Alerts/useTriggerChoices";
import { capitalize } from "@/pages/CoinStats/helper";
import { TimerPush } from "@/pages/CountdownTimer/helper";
import { sizeText } from "@/pages/Studio/helper";
import toolsStyles from "@/pages/Tools/tools.module.css";
import { useLanguage, useT } from "@/ui/i18n";
import { useParams } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { FiPlay } from "react-icons/fi";
import { Embed } from "./Embed";
import {
  Box,
  layerName,
  moveLayer,
  sampleReact,
  Samples,
  sampleText,
  sampleViewerOf,
  sourceValue,
  whenText,
} from "./helper";
import { LayerSettings } from "./LayerSettings";
import { LayersPanel } from "./LayersPanel";
import { OverlaySettings } from "./OverlaySettings";
import { StudioStage } from "./StudioStage";
import styles from "./studioeditor.module.css";

// Numbers the media browses, kept while the page is away so a browse made on
// its return can't get an older one's number, as on the Alerts page
let requests = 0;

/**
 * An Overlay Studio overlay's editor: its layers, the canvas, and the
 * selected layer's settings (the overlay's, with none selected). It opens
 * once main's list holds the overlay.
 */
export function StudioEditor() {
  const t = useT();
  const { id } = useParams({ from: "/tools/studio/$id" });
  const [overlays, setOverlays] = useState<StudioOverlay[]>();

  useIpcRequest(APP_EVENTS.GET_STUDIO);

  // Failures still carry what main holds
  useIpcListener(APP_EVENTS_RESPONSE.STUDIO, (res) => {
    if (res?.data) setOverlays(res.data);
  });

  const saved = overlays?.find((overlay) => overlay.id === id);

  return (
    <Page width="full">
      <div className={styles.frame}>
        {saved ? (
          <Editor key={saved.id} saved={saved} />
        ) : (
          // The header until it comes, so the page can go back
          <Section
            icon={<BackButton to="/tools/studio" title={t("studio.back")} />}
            title={t("studio.title")}
          >
            {overlays ? (
              <EmptyState>{t("studio.editor.gone")}</EmptyState>
            ) : (
              <div className={toolsStyles.loading}>
                <Spinner size={20} />
              </div>
            )}
          </Section>
        )}
      </div>
    </Page>
  );
}

function Editor({ saved }: { saved: StudioOverlay }) {
  const t = useT();
  const language = useLanguage();
  const [overlay, setOverlay] = useAutosave(saved, (changed) =>
    window.api.emit(APP_EVENTS.SAVE_STUDIO_OVERLAY, { overlay: changed }),
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [installed, setInstalled] = useState<OverlayApp[]>([]);
  const [profile, setProfile] = useState<Pick<Profile, "alerts" | "games">>();
  const [timer, setTimer] = useState<TimerPush | null>(null);
  const [serverEnabled, setServerEnabled] = useState(true);
  const { giftChoices, emoteChoices, emotes, setEmotes } = useTriggerChoices();
  // A new one per Test, so its samples are fresh
  const [samples, setSamples] = useState(() => new Samples());
  // The layer whose image or video is being picked
  const [mediaFor, setMediaFor] = useState<string | null>(null);
  // Layers waiting for main to save a browsed file, and the newest request
  // applied to each, as on the Alerts page
  const asked = useRef(new Set<string>());
  const applied = useRef(new Map<string, number>());
  const stage = useRef<Stage | null>(null);

  useIpcRequest(APP_EVENTS.GET_OVERLAYS);
  useIpcRequest(APP_EVENTS.GET_PROFILE);
  useIpcRequest(APP_EVENTS.GET_SETTINGS);
  useIpcRequest(APP_EVENTS.GET_TIMER);

  useIpcListener(APP_EVENTS_RESPONSE.GET_OVERLAYS, (res) => {
    if (res?.success && res.data) setInstalled(res.data);
  });

  // Every reply, which is how a profile switch shows
  useIpcListener(APP_EVENTS_RESPONSE.GET_PROFILE, (res) => {
    if (!res?.success || !res.profile) return;
    setEmotes(res.profile.emotes);
    setProfile({ alerts: res.profile.alerts, games: res.profile.games });
  });

  useIpcListener(APP_EVENTS_RESPONSE.GET_SETTINGS, (res) => {
    if (res?.success) setServerEnabled(res.data!.settings.server.enabled);
  });

  useIpcListener(APP_EVENTS_RESPONSE.TIMER, (res) => {
    if (res?.success && res.data) {
      setTimer({ data: res.data, at: performance.now() });
    }
  });

  const changeLayer = (
    id: string,
    change: (layer: StudioLayer) => StudioLayer,
  ) =>
    setOverlay((o) => ({
      ...o,
      layers: o.layers.map((layer) =>
        layer.id === id ? change(layer) : layer,
      ),
    }));

  const setMedia = (id: string, file: { file: string; name: string } | null) =>
    changeLayer(id, (layer) =>
      layer.kind === "media"
        ? { ...layer, file: file?.file ?? "", name: file?.name ?? "" }
        : layer,
    );

  useIpcListener(APP_EVENTS_RESPONSE.SET_ALERT_MEDIA, (res) => {
    if (!res?.success || !res.media || !asked.current.has(res.id)) return;
    if (res.request <= (applied.current.get(res.id) ?? 0)) return;
    applied.current.set(res.id, res.request);
    setMedia(res.id, res.media);
    setMediaFor((current) => (current === res.id ? null : current));
  });

  // Main took a deleted file off every layer, so the next save can't bring
  // it back
  useIpcListener(APP_EVENTS_RESPONSE.ALERT_FILE_REMOVED, (res) => {
    if (res?.field !== "media") return;
    setOverlay((o) =>
      o.layers.some((l) => l.kind === "media" && l.file === res.file)
        ? {
            ...o,
            layers: o.layers.map((l) =>
              l.kind === "media" && l.file === res.file
                ? { ...l, file: "", name: "" }
                : l,
            ),
          }
        : o,
    );
  });

  const alerts = profile?.alerts.items;
  const games = profile?.games;
  // The games page calls its columns rows when they sit side by side
  const gamesRows = games?.overlay.layout === "horizontal";

  // An embed's name, for its box and its row
  const label = (source: StudioSource): string => {
    switch (source.type) {
      case "installed":
        return (
          installed.find((o) => o.id === source.id)?.name ??
          t("studio.embed.removed")
        );
      case "alert": {
        const index = alerts?.findIndex((a) => a.id === source.id) ?? -1;
        return index === -1
          ? t("studio.embed.alertGone")
          : t("studio.embed.alert", {
              name: alertName(alerts![index].name, index),
            });
      }
      case "timer":
        return t("tools.countdown.title");
      default: {
        if (source.column === null) return t("studio.embed.games");
        const n = String(source.column);
        return gamesRows
          ? t("studio.embed.gamesRow", { row: n })
          : t("studio.embed.gamesColumn", { column: n });
      }
    }
  };

  const view = useMemo(
    () =>
      studioView(overlay, {
        gifts: giftChoices,
        served: (id) => installed.some((o) => o.id === id),
        // Each video its own player URL: Chromium fails players sharing one
        mediaURL: (file, layerId) =>
          mediaKind(file) === "video"
            ? `${getMediaPreviewURL(file)}?player=${encodeURIComponent(layerId)}`
            : getMediaPreviewURL(file),
        embedPath: (source) =>
          source.type === "installed"
            ? getOverlayURL(source.id)
            : source.type === "alert"
              ? getAlertOverlayURL(source.id)
              : source.type === "timer"
                ? getOverlayURL(TIMER_PATH)
                : getMinecraftOverlayURL(source.column ?? undefined),
        text: (layer) => sampleText(layer, samples, language),
        viewer: (layer) => sampleViewerOf(layer, samples),
        label,
      }),
    // label reads installed, alerts, the games layout and t
    [overlay, giftChoices, installed, alerts, gamesRows, samples, language, t],
  );

  const gamesPreview = useMemo(
    () =>
      games && {
        look: games.overlay,
        rows: gameOverlayRows(games, {
          gifts: giftChoices,
          emotes,
          mediaURL: getPicturePreviewURL,
          language,
        }),
      },
    [games, giftChoices, emotes, language],
  );

  // Each column of the games overlay can be placed on its own, and so can one
  // a layer kept after the games overlay lost it
  const gameColumns = Math.max(
    games?.overlay.columns ?? 1,
    ...overlay.layers.map((l) =>
      l.kind === "overlay" && l.source?.type === "games"
        ? (l.source.column ?? 1)
        : 1,
    ),
  );
  const sources: SelectOption<string>[] = [
    ...installed.map((o) => ({ value: `installed:${o.id}`, label: o.name })),
    { value: "timer", label: t("tools.countdown.title") },
    { value: "games", label: t("studio.embed.games") },
    ...(gameColumns > 1
      ? Array.from({ length: gameColumns }, (_, i) => {
          const source = { type: "games", column: i + 1 } as const;
          return { value: sourceValue(source)!, label: label(source) };
        })
      : []),
    ...(alerts ?? []).flatMap((alert: Alert, index) =>
      alert.media
        ? [
            {
              value: `alert:${alert.id}`,
              label: t("studio.embed.alert", {
                name: alertName(alert.name, index),
              }),
            },
          ]
        : [],
    ),
  ];

  const names = Object.fromEntries(
    overlay.layers.map((layer) => {
      const name = layerName(layer, {
        gifts: giftChoices,
        emotes: emoteChoices,
        label,
        t,
      });
      const kind = t(`studio.kinds.${layer.kind}`);
      const when = whenText(layer, t);
      // A layer named after its kind doesn't say its kind twice
      const meta =
        name === kind
          ? capitalize(when, language)
          : t("studio.editor.rowMeta", { kind, when });
      return [layer.id, { name, meta }];
    }),
  );

  const add = (kind: StudioLayerKind) => {
    if (overlay.layers.length >= STUDIO_MAX_LAYERS) return;
    const layer = newStudioLayer(kind, overlay.size);
    // In front of the rest
    setOverlay((o) => ({ ...o, layers: [...o.layers, layer] }));
    setSelected(layer.id);
  };

  const remove = (id: string) => {
    setOverlay((o) => ({ ...o, layers: o.layers.filter((l) => l.id !== id) }));
    setSelected((current) => (current === id ? null : current));
  };

  const move = (id: string, to: number) =>
    setOverlay((o) => ({
      ...o,
      layers: moveLayer(
        o.layers,
        o.layers.findIndex((l) => l.id === id),
        to,
      ),
    }));

  const setBox = (id: string, box: Box) =>
    changeLayer(id, (layer) => ({ ...layer, ...box }));

  // Plays every layer that reacts, with fresh samples, here and on stream
  const test = () => {
    flushSettings();
    const fresh = new Samples();
    setSamples(fresh);
    for (const layer of overlay.layers) {
      if (layer.when !== "always") {
        stage.current?.react(sampleReact(layer, fresh, language));
      }
    }
    window.api.emit(APP_EVENTS.TEST_STUDIO_OVERLAY, { id: overlay.id });
  };

  const layer = overlay.layers.find((l) => l.id === selected);
  const mediaLayer = overlay.layers.find(
    (l) => l.id === mediaFor && l.kind === "media",
  );

  return (
    <>
      <Section
        icon={<BackButton to="/tools/studio" title={t("studio.back")} />}
        title={overlay.name.trim() || t("studio.untitled")}
        actions={
          <>
            <Btn
              variant="icon"
              title={t("studio.editor.test")}
              aria-label={t("studio.editor.test")}
              onClick={test}
            >
              <FiPlay size={20} />
            </Btn>
            <CopyButton
              value={getStudioOverlayURL(overlay.id)}
              title={t("studio.copyUrl")}
            />
          </>
        }
      >
        <div className={styles.panes}>
          <LayersPanel
            layers={overlay.layers}
            selected={selected}
            names={names}
            onSelect={setSelected}
            onAdd={add}
            onDelete={remove}
            onMove={move}
          />

          <div className={styles.canvas_column}>
            {!serverEnabled && (
              <p className={toolsStyles.notice}>{t("studio.serverOff")}</p>
            )}
            <StudioStage
              view={view}
              stageRef={stage}
              selected={selected}
              onSelect={setSelected}
              onBox={setBox}
              embed={(embed) => (
                <Embed
                  layer={embed}
                  installed={installed}
                  timer={timer}
                  games={gamesPreview ?? null}
                />
              )}
            />
            <span className={styles.canvas_size}>{sizeText(overlay.size)}</span>
          </div>

          <div className={styles.panel}>
            {layer ? (
              <LayerSettings
                key={layer.id}
                layer={layer}
                onChange={(changed) => changeLayer(changed.id, () => changed)}
                gifts={giftChoices}
                emotes={emoteChoices}
                sources={sources}
                onPickMedia={() => setMediaFor(layer.id)}
              />
            ) : (
              <OverlaySettings overlay={overlay} onChange={setOverlay} />
            )}
          </div>
        </div>
      </Section>

      {mediaLayer?.kind === "media" && (
        <MediaPicker
          id={mediaLayer.id}
          chosen={mediaLayer.file ? mediaLayer : null}
          onRequest={() => {
            asked.current.add(mediaLayer.id);
            return ++requests;
          }}
          onSelect={(file) => {
            asked.current.delete(mediaLayer.id);
            setMedia(mediaLayer.id, file);
            setMediaFor(null);
          }}
          onClose={() => setMediaFor(null)}
        />
      )}
    </>
  );
}
