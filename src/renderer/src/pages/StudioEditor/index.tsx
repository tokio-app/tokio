import {
  Alert,
  Profile,
  STUDIO_MAX_ELEMENTS,
  STUDIO_MAX_GROUPS,
  STUDIO_SIZES,
  StudioElement,
  StudioElementKind,
  StudioCrop,
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
  reactsToEvents,
  studioCameraPath,
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
  useServerEnabled,
} from "@/hooks";
import { useTriggerChoices } from "@/pages/Alerts/useTriggerChoices";
import { capitalize } from "@/pages/CoinStats/helper";
import { useTimerPush } from "@/pages/CountdownTimer/helper";
import { newOverlayName, sizeText } from "@/pages/Studio/helper";
import toolsStyles from "@/pages/Tools/tools.module.css";
import { useLanguage, useT } from "@/ui/i18n";
import { useParams } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { FiPlay } from "react-icons/fi";
import { LuRedo2, LuUndo2 } from "react-icons/lu";
import { ElementSettings } from "./ElementSettings";
import { Embed } from "./Embed";
import {
  alignTo,
  Box,
  copyItem,
  flipInFrame,
  groupFrame,
  reframe,
  Turned,
  elementName,
  mapElements,
  moveElement,
  moveItem,
  pictureSource,
  recrop,
  sampleReact,
  Samples,
  sampleText,
  sampleSentOf,
  sampleViewerOf,
  sourceValue,
  stepElement,
  whenText,
  WHOLE,
  Words,
} from "./helper";
import { GroupSettings } from "./GroupSettings";
import { ElementFlags, GroupFlags, LayersPanel } from "./LayersPanel";
import { OverlaySettings } from "./OverlaySettings";
import { StudioStage } from "./StudioStage";
import styles from "./studioeditor.module.css";
import { useHistory } from "./useHistory";

// Numbers the media browses, kept while the page is away so a browse made on
// its return can't get an older one's number, as on the Alerts page
let requests = 0;

// A text's fields that change how much room its words take
const WORDS = ["text", "font", "size", "bold"] as const;

// Fields typed in, which keep their own Ctrl+Z. Number fields take the
// editor's, like checkboxes, radios and sliders.
const TEXT_FIELDS =
  "textarea, input:not([type=number]):not([type=checkbox]):not([type=radio]):not([type=range])";
// And their own copy, cut and paste, number fields too
const TYPED_FIELDS =
  "textarea, input:not([type=checkbox]):not([type=radio]):not([type=range])";

// What Ctrl+C or Ctrl+X took, kept until Tokio quits so it pastes into
// another overlay too, and how many steps down and right the next paste goes:
// each one lands a step further, the first after a cut where it was
let clipboard: { item: StudioItem; steps: number } | null = null;
// A paste's step, in px of the canvas
const PASTE_STEP = 20;

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
  const [overlay, setSaved] = useAutosave(saved, (changed) =>
    window.api.emit(APP_EVENTS.SAVE_STUDIO_OVERLAY, { overlay: changed }),
  );
  const [selected, setSelected] = useState<string | null>(null);
  // Every change below goes in the history, but folding a group
  const history = useHistory(overlay, setSaved, selected);
  const setOverlay = history.change;
  const [installed, setInstalled] = useState<OverlayApp[]>([]);
  const [profile, setProfile] = useState<Pick<Profile, "alerts" | "games">>();
  const { giftChoices, emoteChoices, emotes, setEmotes } = useTriggerChoices();
  // A new one per Test, so its samples are fresh
  const [samples, setSamples] = useState(() => new Samples());
  // The element whose image or video is being picked
  const [mediaFor, setMediaFor] = useState<string | null>(null);
  // Width and height change together, in the fields and on the canvas, for
  // every element and group until the editor closes
  const [linked, setLinked] = useState(false);
  // The picture element being cropped on the canvas
  const [cropping, setCropping] = useState<string | null>(null);
  // Elements waiting for main to save a browsed file, and the newest request
  // applied to each, as on the Alerts page
  const asked = useRef(new Set<string>());
  const applied = useRef(new Map<string, number>());
  const stage = useRef<Stage | null>(null);
  // A text whose words its settings just changed: the canvas grows its box
  // to them once it has drawn them
  const fitting = useRef<string | null>(null);
  // The selected text's words, as the canvas measured them
  const [words, setWords] = useState<Words | null>(null);

  useIpcRequest(APP_EVENTS.GET_OVERLAYS);
  useIpcRequest(APP_EVENTS.GET_PROFILE);
  const serverEnabled = useServerEnabled();
  const timer = useTimerPush();

  useIpcListener(APP_EVENTS_RESPONSE.GET_OVERLAYS, (res) => {
    if (res?.success && res.data) setInstalled(res.data);
  });

  // Every reply, which is how a profile switch shows
  useIpcListener(APP_EVENTS_RESPONSE.GET_PROFILE, (res) => {
    if (!res?.success || !res.profile) return;
    setEmotes(res.profile.emotes);
    setProfile({ alerts: res.profile.alerts, games: res.profile.games });
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

  // Another file starts uncropped and uncut, with its volume and loop
  const setMedia = (id: string, file: { file: string; name: string } | null) =>
    changeElement(id, (element) =>
      element.kind === "media"
        ? {
            ...element,
            file: file?.file ?? "",
            name: file?.name ?? "",
            ...(file?.file !== element.file && {
              crop: WHOLE,
              start: 0,
              end: null,
            }),
          }
        : element,
    );

  // A crop typed in: a picture keeps its place and size, its box trimmed to
  // what it keeps, once the stage has read its own size. A viewer's picture
  // fills its circle, so only its crop changes.
  const cropElement = (id: string, crop: StudioCrop) =>
    changeElement(id, (element) => {
      if (!("crop" in element)) return element;
      const own = element.kind === "viewer" ? null : stage.current?.picture(id);
      return own
        ? { ...element, ...recrop(element, own, crop) }
        : { ...element, crop };
    });

  useIpcListener(APP_EVENTS_RESPONSE.SET_ALERT_MEDIA, (res) => {
    if (!res?.success || !res.media || !asked.current.has(res.id)) return;
    if (res.request <= (applied.current.get(res.id) ?? 0)) return;
    applied.current.set(res.id, res.request);
    setMedia(res.id, res.media);
    setMediaFor((current) => (current === res.id ? null : current));
  });

  // Main took a deleted file off every element, so the next save can't
  // bring it back, nor an undo
  useIpcListener(APP_EVENTS_RESPONSE.ALERT_FILE_REMOVED, (res) => {
    if (res?.field !== "media") return;
    const shows = (e: StudioElement): e is StudioElementOf<"media"> =>
      e.kind === "media" && e.file === res.file;
    history.sweep((o) =>
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
        // The stage shows it straight from this window (previewCamera), so
        // its src only names the camera and its quality
        camera: (element) =>
          studioCameraPath("", element.camera, element.quality),
        text: (element) => sampleText(element, samples, language),
        viewer: (element) => sampleViewerOf(element, samples),
        sent: (element) => sampleSentOf(element, samples),
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
  const names = Object.fromEntries([
    ...elements.map((element) => {
      const name = element.label.trim() || autoNames[element.id];
      const kind = t(`studio.kinds.${element.kind}`);
      const when = whenText(element, t);
      // An element named after its kind doesn't say its kind twice
      const meta =
        name === kind
          ? capitalize(when, language)
          : t("studio.editor.rowMeta", { kind, when });
      const reacts = reactsToEvents(element);
      return [
        element.id,
        { name, meta, when: reacts ? capitalize(when, language) : null },
      ];
    }),
    ...overlay.items.flatMap((item) => {
      if (item.kind !== "group") return [];
      const name = item.name.trim() || t("studio.editor.untitledGroup");
      const when = capitalize(whenText(item, t), language);
      return [
        [
          item.id,
          { name, meta: when, when: reactsToEvents(item) ? when : null },
        ],
      ];
    }),
  ]);

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

  // The list's view, which Undo leaves alone
  const fold = (id: string, folded: boolean) =>
    setSaved((o) => ({
      ...o,
      items: o.items.map((item) =>
        item.kind === "group" && item.id === id ? { ...item, folded } : item,
      ),
    }));

  // An element picked in a folded group unfolds it
  const select = (id: string | null) => {
    setSelected(id);
    const holder = holderOf(id);
    if (holder?.folded) fold(holder.id, false);
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

  // The selected group, or element wherever it is, to copy or cut
  const copy = (cut: boolean) => {
    const item = group ?? element;
    if (!item) return;
    clipboard = { item, steps: cut ? 0 : 1 };
    if (cut) remove(item.id);
  };

  // A copy with new ids where the + menu adds: an element into the selected
  // group or the selected element's group, which unfolds, else on its own in
  // front, and a group on its own in front. Not past the caps.
  const paste = () => {
    if (!clipboard) return;
    const { item } = clipboard;
    const count = item.kind === "group" ? item.elements.length : 1;
    if (elements.length + count > STUDIO_MAX_ELEMENTS) return;
    if (item.kind === "group" && groups.length >= STUDIO_MAX_GROUPS) return;
    const pasted = copyItem(item, PASTE_STEP * clipboard.steps);
    clipboard.steps += 1;
    if (pasted.kind !== "group" && target) {
      changeGroup(target.id, (g) => ({
        ...g,
        folded: false,
        elements: [...g.elements, pasted],
      }));
    } else {
      setItems((items) => [...items, pasted]);
    }
    setSelected(pasted.id);
  };

  const shift = (id: string, dx: number, dy: number) =>
    changeGroup(id, (g) => ({
      ...g,
      elements: g.elements.map((e) => ({ ...e, x: e.x + dx, y: e.y + dy })),
    }));

  // A group's frame, around its elements as they show
  const frameOf = (g: StudioGroup) =>
    groupFrame(
      g.elements.filter((e) => !e.hidden),
      g.rotation,
    );
  const frame = group ? frameOf(group) : null;
  const canvas = STUDIO_SIZES[overlay.size];

  // A group's elements when a change to its frame began, by the frame it
  // began from: every step of a drag, or of a run of changes in its fields,
  // goes from them, so rounding doesn't add up. A step run again, as React
  // does in development, finds the same elements, so a turn can't add to
  // the last one.
  const reframing = useRef<{ from: Turned; elements: StudioElement[] }>(null);
  const reframeGroup = (id: string, from: Turned, to: Turned) =>
    changeGroup(id, (g) => {
      if (reframing.current?.from !== from) {
        reframing.current = { from, elements: g.elements };
      }
      return {
        ...g,
        rotation: to.rotation,
        elements: reframe(reframing.current.elements, from, to),
      };
    });

  const flipGroup = (id: string, key: "flip_x" | "flip_y") =>
    changeGroup(id, (g) => {
      const f = frameOf(g);
      if (!f) return g;
      const next = { ...g, elements: flipInFrame(g.elements, f, key) };
      next[key] = !g[key];
      return next;
    });

  const setBox = (id: string, box: Box) =>
    changeElement(id, (e) => ({ ...e, ...box }));

  // Plays every element and group that reacts, elements with fresh
  // samples, here and on stream
  const test = () => {
    flushSettings();
    const fresh = new Samples();
    setSamples(fresh);
    for (const reacts of elements) {
      if (reactsToEvents(reacts)) {
        stage.current?.react(sampleReact(reacts, fresh, language));
      }
    }
    for (const reacts of overlay.items) {
      if (reacts.kind === "group" && !reacts.hidden && reactsToEvents(reacts)) {
        stage.current?.react({ element: reacts.id });
      }
    }
    window.api.emit(APP_EVENTS.TEST_STUDIO_OVERLAY, { id: overlay.id });
  };

  // Ctrl+Z undoes, Ctrl+Y and Ctrl+Shift+Z redo, Ctrl+C copies, Ctrl+X cuts
  // and Ctrl+V pastes, Cmd too. Not in a field that keeps its own, nor in a
  // dialog. Electron's Edit menu only gets the keys the page didn't take.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    // A crop on the canvas ends with Enter or Escape first
    if (!(e.ctrlKey || e.metaKey) || e.altKey || cropping) return;
    const key = e.key.toLowerCase();
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest("[role=dialog]")) return;
    if (key === "z" || key === "y") {
      if (target?.matches(TEXT_FIELDS)) return;
      e.preventDefault();
      if (key === "y" || e.shiftKey) history.redo();
      else history.undo();
      return;
    }
    if (key !== "c" && key !== "x" && key !== "v") return;
    if (target?.matches(TYPED_FIELDS)) return;
    // Text selected on the page copies as text
    if (key !== "v" && document.getSelection()?.toString()) return;
    e.preventDefault();
    if (key === "v") paste();
    else copy(key === "x");
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

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
              title={t("studio.editor.undo")}
              aria-label={t("studio.editor.undo")}
              aria-keyshortcuts="Control+Z Meta+Z"
              disabled={!history.canUndo || cropping !== null}
              onClick={history.undo}
            >
              <LuUndo2 size={20} />
            </Btn>
            <Btn
              variant="icon"
              title={t("studio.editor.redo")}
              aria-label={t("studio.editor.redo")}
              aria-keyshortcuts="Control+Y Control+Shift+Z Meta+Shift+Z"
              disabled={!history.canRedo || cropping !== null}
              onClick={history.redo}
            >
              <LuRedo2 size={20} />
            </Btn>
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
            gifts={giftChoices}
            target={target}
            onSelect={select}
            onAddGroup={addGroup}
            onAdd={add}
            onDelete={remove}
            onFold={fold}
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
              fitting={fitting}
              onWords={setWords}
              selected={selected}
              locked={locked}
              groupFrame={group && !group.hidden ? frame : null}
              onGroupFrame={reframeGroup}
              linked={linked}
              onSelect={select}
              onBox={setBox}
              onRotate={(id, rotation) =>
                changeElement(id, (e) => ({ ...e, rotation }))
              }
              onShift={shift}
              rulers={overlay.rulers}
              // The editor's view, which Undo leaves alone, as folding
              onRulers={(rulers) => setSaved((o) => ({ ...o, rulers }))}
              guides={overlay.guides}
              onGuides={(guides) => setOverlay((o) => ({ ...o, guides }))}
              onHold={history.hold}
              onDelete={remove}
              cropping={cropping}
              onCropStart={(id) => {
                select(id);
                setCropping(id);
              }}
              // Kept, one step of the history
              onCrop={(id, kept) => {
                setCropping(null);
                if (kept) {
                  changeElement(id, (e) =>
                    "crop" in e ? { ...e, ...kept } : e,
                  );
                }
              }}
              embed={(embed) => (
                <Embed
                  element={embed}
                  installed={installed}
                  timer={timer}
                  games={gamesPreview ?? null}
                />
              )}
            >
              <span className={styles.canvas_size}>
                {sizeText(overlay.size)}
              </span>
            </StudioStage>
          </div>

          <div className={styles.panel}>
            {group ? (
              <GroupSettings
                key={group.id}
                group={group}
                frame={frame}
                linked={linked}
                onLinked={setLinked}
                onChange={(changed) => changeGroup(changed.id, () => changed)}
                onFrame={(from, to) => reframeGroup(group.id, from, to)}
                onFlip={(key) => flipGroup(group.id, key)}
                gifts={giftChoices}
                emotes={emoteChoices}
                onAlign={(to) => {
                  if (!frame) return;
                  const at = alignTo(frame, canvas, to);
                  shift(
                    group.id,
                    at.x - Math.round(frame.x),
                    at.y - Math.round(frame.y),
                  );
                }}
              />
            ) : element ? (
              <ElementSettings
                key={element.id}
                element={element}
                autoName={autoNames[element.id]}
                canvas={canvas}
                linked={linked}
                onLinked={setLinked}
                words={words?.id === element.id ? words : undefined}
                onChange={(changed) => {
                  if (
                    changed.kind === "text" &&
                    element.kind === "text" &&
                    WORDS.some((key) => changed[key] !== element[key])
                  ) {
                    fitting.current = changed.id;
                  }
                  // Another gift or emote starts uncropped
                  const other =
                    "crop" in changed &&
                    pictureSource(changed) !== pictureSource(element);
                  changeElement(changed.id, () =>
                    other ? { ...changed, crop: WHOLE } : changed,
                  );
                }}
                gifts={giftChoices}
                emotes={emoteChoices}
                sources={sources}
                onPickMedia={() => setMediaFor(element.id)}
                onCrop={(crop) => cropElement(element.id, crop)}
                onCropCanvas={() => setCropping(element.id)}
                onSeek={(seconds) => stage.current?.hold(element.id, seconds)}
                onPlay={() => stage.current?.replay(element.id)}
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
