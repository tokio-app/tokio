import {
  Alert,
  Profile,
  STUDIO_MAX_ELEMENTS,
  STUDIO_MAX_GROUPS,
  STUDIO_SIZES,
  StudioElement,
  StudioElementKind,
  StudioElementOf,
  StudioGroup,
  StudioItem,
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
  newStudioElement,
  newStudioGroup,
  studioElements,
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
import { newOverlayName, sizeText } from "@/pages/Studio/helper";
import toolsStyles from "@/pages/Tools/tools.module.css";
import { useLanguage, useT } from "@/ui/i18n";
import { useParams } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { FiPlay } from "react-icons/fi";
import { ElementSettings } from "./ElementSettings";
import { Embed } from "./Embed";
import {
  Box,
  elementName,
  mapElements,
  moveElement,
  moveItem,
  sampleReact,
  Samples,
  sampleText,
  sampleGiftOf,
  sampleViewerOf,
  sourceValue,
  stepElement,
  whenText,
} from "./helper";
import { GroupSettings } from "./GroupSettings";
import { ElementFlags, GroupFlags, LayersPanel } from "./LayersPanel";
import { OverlaySettings } from "./OverlaySettings";
import { StudioStage } from "./StudioStage";
import styles from "./studioeditor.module.css";

// Numbers the media browses, kept while the page is away so a browse made on
// its return can't get an older one's number, as on the Alerts page
let requests = 0;

/**
 * An Overlay Studio overlay's editor: its groups and elements, the
 * canvas, and the selection's settings (the overlay's, with none). It opens
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
  // The element whose image or video is being picked
  const [mediaFor, setMediaFor] = useState<string | null>(null);
  // Elements waiting for main to save a browsed file, and the newest request
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

  const setItems = (change: (items: StudioItem[]) => StudioItem[]) =>
    setOverlay((o) => ({ ...o, items: change(o.items) }));

  const changeGroup = (
    id: string,
    change: (group: StudioGroup) => StudioGroup,
  ) =>
    setItems((items) =>
      items.map((item) =>
        item.kind === "group" && item.id === id ? change(item) : item,
      ),
    );

  const changeElement = (
    id: string,
    change: (element: StudioElement) => StudioElement,
  ) =>
    setItems((items) =>
      mapElements(items, (e) => (e.id === id ? change(e) : e)),
    );

  const setMedia = (id: string, file: { file: string; name: string } | null) =>
    changeElement(id, (element) =>
      element.kind === "media"
        ? { ...element, file: file?.file ?? "", name: file?.name ?? "" }
        : element,
    );

  useIpcListener(APP_EVENTS_RESPONSE.SET_ALERT_MEDIA, (res) => {
    if (!res?.success || !res.media || !asked.current.has(res.id)) return;
    if (res.request <= (applied.current.get(res.id) ?? 0)) return;
    applied.current.set(res.id, res.request);
    setMedia(res.id, res.media);
    setMediaFor((current) => (current === res.id ? null : current));
  });

  // Main took a deleted file off every element, so the next save can't
  // bring it back
  useIpcListener(APP_EVENTS_RESPONSE.ALERT_FILE_REMOVED, (res) => {
    if (res?.field !== "media") return;
    const shows = (e: StudioElement): e is StudioElementOf<"media"> =>
      e.kind === "media" && e.file === res.file;
    setOverlay((o) =>
      studioElements(o).some(shows)
        ? {
            ...o,
            items: mapElements(o.items, (e) =>
              shows(e) ? { ...e, file: "", name: "" } : e,
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
        mediaURL: (file, elementId) =>
          mediaKind(file) === "video"
            ? `${getMediaPreviewURL(file)}?player=${encodeURIComponent(elementId)}`
            : getMediaPreviewURL(file),
        embedPath: (source) =>
          source.type === "installed"
            ? getOverlayURL(source.id)
            : source.type === "alert"
              ? getAlertOverlayURL(source.id)
              : source.type === "timer"
                ? getOverlayURL(TIMER_PATH)
                : getMinecraftOverlayURL(source.column ?? undefined),
        text: (element) => sampleText(element, samples, language),
        viewer: (element) => sampleViewerOf(element, samples),
        sentGift: (element) => sampleGiftOf(element, samples),
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
  // an element kept after the games overlay lost it
  const elements = studioElements(overlay);
  const gameColumns = Math.max(
    games?.overlay.columns ?? 1,
    ...elements.map((e) =>
      e.kind === "overlay" && e.source?.type === "games"
        ? (e.source.column ?? 1)
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

  // What each element's row calls it with no label
  const autoNames = Object.fromEntries(
    elements.map((element) => [
      element.id,
      elementName(element, {
        gifts: giftChoices,
        emotes: emoteChoices,
        label,
        t,
      }),
    ]),
  );
  const names = Object.fromEntries(
    elements.map((element) => {
      const name = element.label.trim() || autoNames[element.id];
      const kind = t(`studio.kinds.${element.kind}`);
      const when = whenText(element, t);
      // An element named after its kind doesn't say its kind twice
      const meta =
        name === kind
          ? capitalize(when, language)
          : t("studio.editor.rowMeta", { kind, when });
      return [element.id, { name, meta }];
    }),
  );

  const groups = overlay.items.filter((item) => item.kind === "group");
  const group = groups.find((g) => g.id === selected);
  const element = elements.find((e) => e.id === selected);
  // The group an element is in, none on its own
  const holderOf = (id: string | null) =>
    groups.find((g) => g.elements.some((e) => e.id === id));
  // Where the menu adds: the selected group, the selected element's, else
  // on its own
  const target = group ?? holderOf(selected);
  // The locked groups' and elements' ids: unique across both
  const locked = useMemo(
    () =>
      new Set(
        [...overlay.items, ...studioElements(overlay)]
          .filter((item) => item.locked)
          .map((item) => item.id),
      ),
    [overlay],
  );

  // An element picked in a folded group unfolds it
  const select = (id: string | null) => {
    setSelected(id);
    const holder = holderOf(id);
    if (holder?.folded) {
      changeGroup(holder.id, (g) => ({ ...g, folded: false }));
    }
  };

  const addGroup = () => {
    if (groups.length >= STUDIO_MAX_GROUPS) return;
    // "Group N", the first number no group's name uses
    const added = newStudioGroup(
      newOverlayName(groups, (number) =>
        t("studio.editor.groupName", { number: String(number) }),
      ),
    );
    // In front of the rest
    setItems((items) => [...items, added]);
    setSelected(added.id);
  };

  const add = (kind: StudioElementKind) => {
    if (elements.length >= STUDIO_MAX_ELEMENTS) return;
    const added = newStudioElement(kind, overlay.size);
    // In front in its group, which unfolds to show it, else in front of all
    if (target) {
      changeGroup(target.id, (g) => ({
        ...g,
        folded: false,
        elements: [...g.elements, added],
      }));
    } else {
      setItems((items) => [...items, added]);
    }
    setSelected(added.id);
  };

  // A group with its elements, or one element
  const remove = (id: string) => {
    setItems((items) =>
      items
        .filter((item) => item.id !== id)
        .map((item) =>
          item.kind === "group" && item.elements.some((e) => e.id === id)
            ? { ...item, elements: item.elements.filter((e) => e.id !== id) }
            : item,
        ),
    );
    setSelected((current) => (current === id ? null : current));
  };

  const shift = (id: string, dx: number, dy: number) =>
    changeGroup(id, (g) => ({
      ...g,
      elements: g.elements.map((e) => ({ ...e, x: e.x + dx, y: e.y + dy })),
    }));

  const setBox = (id: string, box: Box) =>
    changeElement(id, (e) => ({ ...e, ...box }));

  // Plays every element that reacts, with fresh samples, here and on stream
  const test = () => {
    flushSettings();
    const fresh = new Samples();
    setSamples(fresh);
    for (const reacts of elements) {
      if (reacts.when !== "always") {
        stage.current?.react(sampleReact(reacts, fresh, language));
      }
    }
    window.api.emit(APP_EVENTS.TEST_STUDIO_OVERLAY, { id: overlay.id });
  };

  const mediaElement = elements.find(
    (e) => e.id === mediaFor && e.kind === "media",
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
            items={overlay.items}
            selected={selected}
            names={names}
            target={target}
            onSelect={select}
            onAddGroup={addGroup}
            onAdd={add}
            onDelete={remove}
            onFlags={(id, flags: GroupFlags) =>
              changeGroup(id, (g) => ({ ...g, ...flags }))
            }
            onElementFlags={(id, flags: ElementFlags) =>
              changeElement(id, (e) => ({ ...e, ...flags }))
            }
            onMoveItem={(id, to) =>
              setItems((items) =>
                moveItem(
                  items,
                  items.findIndex((item) => item.id === id),
                  to,
                ),
              )
            }
            onMoveElement={(id, groupId, to) =>
              setItems((items) => moveElement(items, id, groupId, to))
            }
            onStepElement={(id, by) =>
              setItems((items) => stepElement(items, id, by))
            }
          />

          <div className={styles.canvas_column}>
            {!serverEnabled && (
              <p className={toolsStyles.notice}>{t("studio.serverOff")}</p>
            )}
            <StudioStage
              view={view}
              stageRef={stage}
              selected={selected}
              locked={locked}
              onSelect={select}
              onBox={setBox}
              onRotate={(id, rotation) =>
                changeElement(id, (e) => ({ ...e, rotation }))
              }
              onShift={shift}
              embed={(embed) => (
                <Embed
                  element={embed}
                  installed={installed}
                  timer={timer}
                  games={gamesPreview ?? null}
                />
              )}
            />
            <span className={styles.canvas_size}>{sizeText(overlay.size)}</span>
          </div>

          <div className={styles.panel}>
            {group ? (
              <GroupSettings
                key={group.id}
                group={group}
                onChange={(changed) => changeGroup(changed.id, () => changed)}
              />
            ) : element ? (
              <ElementSettings
                key={element.id}
                element={element}
                autoName={autoNames[element.id]}
                canvas={STUDIO_SIZES[overlay.size]}
                onChange={(changed) => changeElement(changed.id, () => changed)}
                gifts={giftChoices}
                emotes={emoteChoices}
                sources={sources}
                onPickMedia={() => setMediaFor(element.id)}
              />
            ) : (
              <OverlaySettings overlay={overlay} onChange={setOverlay} />
            )}
          </div>
        </div>
      </Section>

      {mediaElement?.kind === "media" && (
        <MediaPicker
          id={mediaElement.id}
          chosen={mediaElement.file ? mediaElement : null}
          onRequest={() => {
            asked.current.add(mediaElement.id);
            return ++requests;
          }}
          onSelect={(file) => {
            asked.current.delete(mediaElement.id);
            setMedia(mediaElement.id, file);
            setMediaFor(null);
          }}
          onClose={() => setMediaFor(null)}
        />
      )}
    </>
  );
}
