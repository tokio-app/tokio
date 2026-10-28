import { MessageKey } from "@/common/i18n";
import {
  GameAction,
  GameOverlayItem,
  GAMES_OVERLAY_MAX_COLUMNS,
  GamesOverlayFormat,
  GamesOverlayLayout,
  GamesOverlaySize,
  Profile,
  SavedEmote,
} from "@/common/schemas";
import {
  ALERT_TRIGGER_LABELS,
  APP_EVENTS,
  CustomGift,
  TOKIO_EVENTS,
} from "@/common/types";
import {
  gameEventPictures,
  gameCount,
  gameEventCount,
  gameEventText,
  gameOverlayRows,
  gameStepsText,
  getMinecraftOverlayURL,
  getPicturePreviewURL,
} from "@/common/util";
import {
  Btn,
  Check,
  Color,
  CopyField,
  EmptyState,
  Field,
  Input,
  RadioGroup,
  Section,
  Select,
} from "@/components";
import { cx } from "@/helper/cx";
import { scopeUpdater, Updater } from "@/hooks";
import { useLanguage, useOptions, useT } from "@/ui/i18n";
import { useState } from "react";
import { FiPlay, FiPlus } from "react-icons/fi";
import styles from "../games.module.css";
import { OverlayPreview, PixelArrow, usePictureTurn } from "./OverlayPreview";

const LAYOUTS: { value: GamesOverlayLayout; label: MessageKey }[] = [
  { value: "list", label: "games.overlay.layout.list" },
  { value: "carousel", label: "games.overlay.layout.carousel" },
];

const FORMATS: { value: GamesOverlayFormat; label: MessageKey }[] = [
  { value: "arrow", label: "games.overlay.format.arrow" },
  { value: "sticker", label: "games.overlay.format.sticker" },
];

const SIZES: { value: GamesOverlaySize; label: MessageKey }[] = [
  { value: "small", label: "games.overlay.size.small" },
  { value: "medium", label: "games.overlay.size.medium" },
  { value: "large", label: "games.overlay.size.large" },
];

// 1 to the most, as RadioGroup takes text
const COLUMNS = Array.from({ length: GAMES_OVERLAY_MAX_COLUMNS }, (_, i) => ({
  value: String(i + 1),
  label: String(i + 1),
}));

const COLORS = [
  { key: "text_color", label: "games.overlay.color.text" },
  { key: "accent_color", label: "games.overlay.color.accent" },
  { key: "arrow_color", label: "games.overlay.color.arrow" },
] as const;

type Props = {
  games: Profile["games"];
  gifts: CustomGift[];
  emotes: SavedEmote[];
  // The overlay shows on stream only while the server runs
  serverEnabled: boolean;
  update: Updater<Profile["games"]>;
  // Opens the picture picker for the action
  onPickPicture: (id: string) => void;
};

/**
 * Builds the games overlay: how each action shows on it, the look, and a
 * preview. Test lights the next row, in the preview and on stream.
 */
export function OverlaySection({
  games,
  gifts,
  emotes,
  serverEnabled,
  update,
  onPickPicture,
}: Props) {
  const t = useT();
  const language = useLanguage();
  const layouts = useOptions(LAYOUTS);
  const formats = useOptions(FORMATS);
  const sizes = useOptions(SIZES);
  const { actions, overlay: look } = games;
  const rows = gameOverlayRows(games, {
    gifts,
    emotes,
    mediaURL: getPicturePreviewURL,
    language,
  });
  // How many times Test was pressed, and the row it lit last
  const [tests, setTests] = useState(0);
  const [run, setRun] = useState<{ id: string } | null>(null);
  const setLook = scopeUpdater(update, "overlay");
  // Which of a row's gifts shows, all rows in step
  const pictureTurn = usePictureTurn();

  const setItem = (id: string, patch: Partial<GameOverlayItem>) =>
    update((s) => {
      const action = s.actions.find((a) => a.id === id);
      if (action) Object.assign(action.overlay, patch);
    });

  return (
    <Section
      title={t("games.overlay.title")}
      description={t("games.overlay.description")}
      actions={
        <Btn
          variant="icon"
          title={t("games.overlay.lightNext")}
          aria-label={t("games.overlay.lightNext")}
          disabled={rows.length === 0}
          onClick={() => {
            const { id } = rows[tests % rows.length];
            setTests(tests + 1);
            setRun({ id });
            window.api.emit(APP_EVENTS.TEST_GAMES_OVERLAY, { id });
          }}
        >
          <FiPlay size={20} />
        </Btn>
      }
    >
      {!serverEnabled && (
        <p className={styles.notice}>{t("games.overlay.serverOff")}</p>
      )}

      {/* Each column is its own overlay, with its own URL */}
      <Field label={t("games.overlay.urls", { count: look.columns })}>
        {look.columns > 1 ? (
          Array.from({ length: look.columns }, (_, i) => (
            <CopyField
              key={i}
              value={getMinecraftOverlayURL(i + 1)}
              title={t("games.overlay.copyColumnURL", {
                column: String(i + 1),
              })}
            />
          ))
        ) : (
          <CopyField
            value={getMinecraftOverlayURL()}
            title={t("games.overlay.copyURL")}
          />
        )}
      </Field>

      <div className={styles.overlay}>
        <div className={styles.overlay_rows}>
          {actions.length === 0 ? (
            <EmptyState>{t("games.overlay.empty")}</EmptyState>
          ) : (
            <ul
              className={cx(
                styles.recipes,
                look.columns > 1 && styles.recipes_columns,
              )}
              aria-label={t("games.overlay.rows")}
            >
              {actions.map((action) => (
                <RecipeRow
                  key={action.id}
                  action={action}
                  columns={look.columns}
                  pictureTurn={pictureTurn}
                  gifts={gifts}
                  emotes={emotes}
                  onChange={(patch) => setItem(action.id, patch)}
                  onPickPicture={() => onPickPicture(action.id)}
                />
              ))}
            </ul>
          )}
        </div>

        <div className={styles.overlay_side}>
          <OverlayPreview look={look} rows={rows} run={run} />

          <div className={styles.look_choices}>
            <Field label={t("games.overlay.layout")} className={styles.layouts}>
              <RadioGroup
                name="games-overlay-layout"
                value={look.layout}
                options={layouts}
                onChange={(layout) =>
                  setLook((l) => {
                    l.layout = layout;
                  })
                }
              />
            </Field>
            <Field label={t("games.overlay.format")} className={styles.layouts}>
              <RadioGroup
                name="games-overlay-format"
                value={look.format}
                options={formats}
                onChange={(format) =>
                  setLook((l) => {
                    l.format = format;
                  })
                }
              />
            </Field>
            <Field
              label={t("games.overlay.columns")}
              className={styles.layouts}
            >
              <RadioGroup
                name="games-overlay-columns"
                value={String(look.columns)}
                options={COLUMNS}
                onChange={(columns) =>
                  setLook((l) => {
                    l.columns = Number(columns);
                  })
                }
              />
            </Field>
            <Field
              label={t("games.overlay.eventPictures")}
              className={styles.layouts}
            >
              <RadioGroup
                name="games-overlay-event-size"
                value={look.event_size}
                options={sizes}
                onChange={(size) =>
                  setLook((l) => {
                    l.event_size = size;
                  })
                }
              />
            </Field>
          </div>
          <Check
            label={t("games.overlay.picturesOnly")}
            checked={look.pictures_only}
            onChange={(e) => {
              const only = e.target.checked;
              setLook((l) => {
                l.pictures_only = only;
              });
            }}
          />
          <Check
            label={t("games.overlay.textBelow")}
            checked={look.text_below}
            onChange={(e) => {
              const below = e.target.checked;
              setLook((l) => {
                l.text_below = below;
              });
            }}
          />
          <div className={styles.look_fields}>
            <Field label={t("games.overlay.font")}>
              <Input
                maxLength={60}
                placeholder="Archivo"
                value={look.font}
                onChange={(e) => {
                  const font = e.target.value;
                  setLook((l) => {
                    l.font = font;
                  });
                }}
              />
            </Field>
            {/* Stickers have no arrow */}
            {COLORS.filter(
              ({ key }) => key !== "arrow_color" || look.format === "arrow",
            ).map(({ key, label }) => (
              <Field key={key} label={t(label)}>
                <Color
                  value={look[key]}
                  onChange={(color) =>
                    setLook((l) => {
                      l[key] = color;
                    })
                  }
                />
              </Field>
            ))}
          </div>
          <p className={styles.note}>{t("common.fontsNote")}</p>
        </div>
      </div>
    </Section>
  );
}

type RowProps = {
  action: GameAction;
  // With more than one, the row picks its column
  columns: number;
  pictureTurn: number;
  gifts: CustomGift[];
  emotes: SavedEmote[];
  onChange: (patch: Partial<GameOverlayItem>) => void;
  onPickPicture: () => void;
};

// An action's row, read like the overlay's: the event, an arrow, then the
// picture and name. A disabled action's is dimmed, since it doesn't run.
function RecipeRow({
  action,
  columns,
  pictureTurn,
  gifts,
  emotes,
  onChange,
  onPickPicture,
}: RowProps) {
  const t = useT();
  const language = useLanguage();
  const { overlay, trigger } = action;
  const pictures = gameEventPictures(action, gifts, emotes);
  const eventText = gameEventText(action, gifts, language);
  // A chat's message shows by its bubble, so it keeps its text field
  const chat = trigger.type === TOKIO_EVENTS.CHAT;
  const pick = t(
    overlay.image ? "games.overlay.changePicture" : "games.overlay.pickPicture",
  );
  // On the pictures' corners, as on the overlay
  const count = overlay.image ? gameCount(action) : 0;
  const likes = gameEventCount(action);

  // The gifts', emotes' or Tokio's pictures say what they are, as on the
  // overlay, taking turns in one place
  const eventPictures = pictures.length > 0 && (
    <span
      className={styles.recipe_gift}
      role="img"
      aria-label={chat ? t(ALERT_TRIGGER_LABELS[trigger.type]) : eventText}
      title={chat ? t(ALERT_TRIGGER_LABELS[trigger.type]) : eventText}
    >
      {pictures.map((src, i) => (
        <img
          key={src}
          className={cx(
            styles.recipe_picture,
            i !== pictureTurn % pictures.length && styles.recipe_away,
          )}
          src={src}
          alt=""
        />
      ))}
      {likes > 0 && (
        <span className={styles.slot_count} aria-hidden>
          {likes}
        </span>
      )}
    </span>
  );
  // Empty, the event's own text shows, and goes on the overlay
  const eventField = (
    <Input
      aria-label={t("games.overlay.eventText")}
      maxLength={40}
      placeholder={eventText || t("games.overlay.noText")}
      value={overlay.event}
      onChange={(e) => onChange({ event: e.target.value })}
    />
  );

  return (
    <li className={cx(styles.recipe, !action.enabled && styles.recipe_off)}>
      <Check
        aria-label={t("games.overlay.show")}
        checked={overlay.show}
        onChange={(e) => onChange({ show: e.target.checked })}
      />
      {chat ? (
        <span className={styles.recipe_chat}>
          {eventPictures}
          {eventField}
        </span>
      ) : (
        eventPictures || eventField
      )}
      <PixelArrow className={styles.recipe_arrow} />
      <button
        type="button"
        className={styles.slot}
        title={pick}
        aria-label={pick}
        onClick={onPickPicture}
      >
        {overlay.image ? (
          <img src={getPicturePreviewURL(overlay.image.file)} alt="" />
        ) : (
          <FiPlus size={18} />
        )}
        {count > 0 && (
          <span className={styles.slot_count} aria-hidden>
            {count}
          </span>
        )}
      </button>
      {/* Empty, what the steps make shows, as the event's text does */}
      <Input
        aria-label={t("games.overlay.name")}
        maxLength={40}
        placeholder={
          gameStepsText(action, language, count > 0) ||
          t("games.overlay.noName")
        }
        value={overlay.name}
        onChange={(e) => onChange({ name: e.target.value })}
      />
      {columns > 1 && (
        <Select
          aria-label={t("games.overlay.column")}
          options={Array.from({ length: columns }, (_, i) => ({
            value: i + 1,
            label: t("games.overlay.columnN", { column: String(i + 1) }),
          }))}
          // One past the columns shows in the last, as on stream
          value={Math.min(overlay.column, columns)}
          onChange={(column) => onChange({ column })}
        />
      )}
    </li>
  );
}
