import {
  GameAction,
  GameOverlayItem,
  GAMES_OVERLAY_MAX_COLUMNS,
  GamesOverlayLayout,
  Profile,
  SavedEmote,
} from "@/common/schemas";
import { APP_EVENTS, CustomGift } from "@/common/types";
import {
  gameEventPictures,
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
import { useState } from "react";
import { FiPlay, FiPlus } from "react-icons/fi";
import styles from "../games.module.css";
import { OverlayPreview, PixelArrow } from "./OverlayPreview";

const LAYOUTS: { value: GamesOverlayLayout; label: string }[] = [
  { value: "list", label: "List" },
  { value: "carousel", label: "One at a time" },
];

// 1 to the most, as RadioGroup takes text
const COLUMNS = Array.from({ length: GAMES_OVERLAY_MAX_COLUMNS }, (_, i) => ({
  value: String(i + 1),
  label: String(i + 1),
}));

const COLORS = [
  { key: "text_color", label: "Text" },
  { key: "accent_color", label: "Accent" },
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
  const { actions, overlay: look } = games;
  const rows = gameOverlayRows(games, {
    gifts,
    emotes,
    mediaURL: getPicturePreviewURL,
  });
  // How many times Test was pressed, and the row it lit last
  const [tests, setTests] = useState(0);
  const [run, setRun] = useState<{ id: string } | null>(null);
  const setLook = scopeUpdater(update, "overlay");

  const setItem = (id: string, patch: Partial<GameOverlayItem>) =>
    update((s) => {
      const action = s.actions.find((a) => a.id === id);
      if (action) Object.assign(action.overlay, patch);
    });

  return (
    <Section
      title="Overlay"
      description="Show your actions on stream."
      actions={
        <Btn
          variant="icon"
          title="Light up the next row"
          aria-label="Light up the next row"
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
        <p className={styles.notice}>
          The overlay server is off. Enable it in Settings to show this overlay
          on stream.
        </p>
      )}

      {/* Each column is its own overlay, with its own URL */}
      <Field label={look.columns > 1 ? "Overlay URLs" : "Overlay URL"}>
        {look.columns > 1 ? (
          Array.from({ length: look.columns }, (_, i) => (
            <CopyField
              key={i}
              value={getMinecraftOverlayURL(i + 1)}
              title={`Copy column ${i + 1}'s URL`}
            />
          ))
        ) : (
          <CopyField
            value={getMinecraftOverlayURL()}
            title="Copy the overlay's URL"
          />
        )}
      </Field>

      <div className={styles.overlay}>
        <div className={styles.overlay_rows}>
          {actions.length === 0 ? (
            <EmptyState>Add an action to put it on the overlay.</EmptyState>
          ) : (
            <ul className={styles.recipes} aria-label="Actions on the overlay">
              {actions.map((action) => (
                <RecipeRow
                  key={action.id}
                  action={action}
                  columns={look.columns}
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

          <Field label="Layout" className={styles.layouts}>
            <RadioGroup
              name="games-overlay-layout"
              value={look.layout}
              options={LAYOUTS}
              onChange={(layout) =>
                setLook((l) => {
                  l.layout = layout;
                })
              }
            />
          </Field>
          <Field label="Columns" className={styles.layouts}>
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
          <Check
            label="Pictures only"
            checked={look.pictures_only}
            onChange={(e) => {
              const only = e.target.checked;
              setLook((l) => {
                l.pictures_only = only;
              });
            }}
          />
          <div className={styles.look_fields}>
            <Field label="Font">
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
            {COLORS.map(({ key, label }) => (
              <Field key={key} label={label}>
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
          <p className={styles.note}>
            Fonts installed on the computer with your streaming app.
          </p>
        </div>
      </div>
    </Section>
  );
}

type RowProps = {
  action: GameAction;
  // With more than one, the row picks its column
  columns: number;
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
  gifts,
  emotes,
  onChange,
  onPickPicture,
}: RowProps) {
  const { overlay } = action;
  const pictures = gameEventPictures(action, gifts, emotes);
  const pick = overlay.image ? "Change the picture" : "Pick a picture";

  return (
    <li
      className={cx(
        styles.recipe,
        columns > 1 && styles.recipe_columns,
        !action.enabled && styles.recipe_off,
      )}
    >
      <Check
        aria-label="Show on the overlay"
        checked={overlay.show}
        onChange={(e) => onChange({ show: e.target.checked })}
      />
      <span className={styles.recipe_pictures}>
        {pictures.map((src, i) => (
          // Two gifts can share a picture
          <img key={i} className={styles.recipe_picture} src={src} alt="" />
        ))}
      </span>
      {/* Empty, the event's own text shows, and goes on the overlay */}
      <Input
        aria-label="Event text"
        maxLength={40}
        placeholder={gameEventText(action, gifts)}
        value={overlay.event}
        onChange={(e) => onChange({ event: e.target.value })}
      />
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
      </button>
      {/* Empty, what the steps make shows, as the event's text does */}
      <Input
        aria-label="Name on the overlay"
        maxLength={40}
        placeholder={gameStepsText(action) || "No name"}
        value={overlay.name}
        onChange={(e) => onChange({ name: e.target.value })}
      />
      {columns > 1 && (
        <Select
          aria-label="Column"
          options={Array.from({ length: columns }, (_, i) => ({
            value: i + 1,
            label: `Column ${i + 1}`,
          }))}
          // One past the columns shows in the last, as on stream
          value={Math.min(overlay.column, columns)}
          onChange={(column) => onChange({ column })}
        />
      )}
    </li>
  );
}
