import {
  Alert,
  AlertMedia,
  MEDIA_MAX_DURATION,
  Trigger,
  VIEWER_ROLES,
} from "@/common/schemas";
import {
  ALERT_TRIGGER_LABELS,
  CustomGift,
  EMOTE_TRIGGER,
  TOKIO_EVENTS,
} from "@/common/types";
import {
  cutPart,
  defaultAlertName,
  formatAdded,
  getAlertOverlayURL,
  mediaKind,
  takesRoles,
} from "@/common/util";
import {
  alertTest,
  Btn,
  Check,
  CopyField,
  EmoteOption,
  Field,
  Input,
  MediaThumbnail,
  Modal,
  NumberInput,
  PlayButton,
  ROLE_NAMES,
  useVideoURL,
  Select,
  Slider,
  Tabs,
  TestState,
  testProps,
  TRIGGER_OPTIONS,
  TriggerFilter,
} from "@/components";
import thumbs from "@/components/MediaPicker/mediapicker.module.css";
import { AlertTestRequest } from "@/hooks";
import { useOptions, useT } from "@/ui/i18n";
import { ReactNode, RefObject, useEffect, useRef, useState } from "react";
import {
  FiImage,
  FiMessageSquare,
  FiMusic,
  FiPause,
  FiPlay,
  FiVolume2,
} from "react-icons/fi";
import styles from "./editor.module.css";
import { Cut, CutTrack, ResetCut, SoundCut } from "./SoundCut";

type Tab = "trigger" | "sound" | "media";

const TABS: { value: Tab; label: string }[] = [
  { value: "trigger", label: "Trigger" },
  { value: "sound", label: "Sound" },
  { value: "media", label: "Media" },
];

// What TriggerFilter's field is for, for the triggers that have one
const FILTER_LABELS: Partial<Record<Trigger["type"], string>> = {
  [TOKIO_EVENTS.GIFT]: "Gifts",
  [EMOTE_TRIGGER]: "Emotes",
  [TOKIO_EVENTS.CHAT]: "Keyword",
  [TOKIO_EVENTS.MEMBER_JOIN]: "Viewer",
  [TOKIO_EVENTS.SUPER_FAN_JOIN]: "Viewer",
};

type Props = {
  alert: Alert;
  // Its place in the list, which its default name counts
  index: number;
  // TikTok's gifts and the ones seen in LIVEs, see giftOptions
  gifts: CustomGift[];
  emotes: EmoteOption[];
  // The sound test loading or playing, maybe this alert's
  testing: TestState;
  onTest: (req: AlertTestRequest) => void;
  onChange: (alert: Alert) => void;
  // Open the sound or media picker over the editor
  onPickSound: () => void;
  onPickMedia: () => void;
  onClose: () => void;
};

/**
 * Edits an alert: its name, what sets it off, what it plays and how much of
 * it, and what it shows. Changes save as they're made.
 */
export function AlertEditor({
  alert,
  index,
  gifts,
  emotes,
  testing,
  onTest,
  onChange,
  onPickSound,
  onPickMedia,
  onClose,
}: Props) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("trigger");
  const test = alertTest(alert);

  return (
    <Modal
      title={t("alerts.editor.title", {
        trigger: t(ALERT_TRIGGER_LABELS[alert.trigger.type]),
      })}
      maxWidth="720px"
      onClose={onClose}
      footer={
        <Btn variant="accent" onClick={onClose}>
          Done
        </Btn>
      }
    >
      {/* The whole alert's, so above the tabs */}
      <label className={styles.name}>
        Name
        <Input
          className={styles.name_input}
          placeholder={defaultAlertName(index)}
          value={alert.name}
          onChange={(e) => onChange({ ...alert, name: e.target.value })}
        />
      </label>

      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      <div className={styles.panel}>
        {tab === "trigger" && (
          <TriggerTab
            trigger={alert.trigger}
            gifts={gifts}
            emotes={emotes}
            onChange={(trigger) => onChange({ ...alert, trigger })}
          />
        )}
        {tab === "sound" && (
          <SoundTab
            alert={alert}
            playing={testing?.id === alert.id && !testing.loading}
            play={
              <PlayButton
                {...testProps(testing, alert.id)}
                disabled={!test}
                onClick={() => test && onTest(test)}
              />
            }
            onChange={onChange}
            onPick={onPickSound}
          />
        )}
        {tab === "media" && (
          <MediaTab alert={alert} onChange={onChange} onPick={onPickMedia} />
        )}
      </div>
    </Modal>
  );
}

type TriggerTabProps = {
  trigger: Trigger;
  gifts: CustomGift[];
  emotes: EmoteOption[];
  onChange: (trigger: Trigger) => void;
};

function TriggerTab({ trigger, gifts, emotes, onChange }: TriggerTabProps) {
  const t = useT();
  const triggers = useOptions(TRIGGER_OPTIONS);
  const filter = FILTER_LABELS[trigger.type];
  const { roles } = trigger;

  return (
    <>
      <Field label="Event">
        <Select
          aria-label="Event"
          options={triggers}
          value={trigger.type}
          onChange={(type) => onChange({ ...trigger, type })}
        />
      </Field>

      {filter && (
        <Field label={filter}>
          <TriggerFilter
            trigger={trigger}
            gifts={gifts}
            emotes={emotes}
            onChange={onChange}
          />
        </Field>
      )}

      {/* Picked gifts are the alert's choice already */}
      {trigger.type === TOKIO_EVENTS.GIFT && trigger.gifts.length === 0 && (
        <Field label="Worth at least">
          <span className={styles.inline}>
            <NumberInput
              integer
              min={0}
              className={styles.number}
              aria-label="Coins"
              value={trigger.min_coins}
              onChange={(min_coins) => onChange({ ...trigger, min_coins })}
            />
            coins
          </span>
          <p className={styles.note}>
            {trigger.every_gift
              ? "Each gift's coins. 0 for any gift."
              : "The whole streak's coins, when it ends. 0 for any streak."}
          </p>
        </Field>
      )}

      {takesRoles(trigger.type) && (
        <Field label="From">
          <div className={styles.roles}>
            {VIEWER_ROLES.map((role) => (
              <Check
                key={role}
                label={t(ROLE_NAMES[role])}
                checked={roles.includes(role)}
                onChange={(e) =>
                  onChange({
                    ...trigger,
                    roles: e.target.checked
                      ? [...roles, role]
                      : roles.filter((r) => r !== role),
                  })
                }
              />
            ))}
          </div>
          <p className={styles.note}>None checked: anyone.</p>
        </Field>
      )}
    </>
  );
}

// A volume and its value, the sound's or the video's
function Volume({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (volume: number) => void;
}) {
  return (
    <Field label="Volume">
      <div className={styles.volume}>
        <FiVolume2 size={18} aria-hidden />
        <Slider
          aria-label={label}
          min={0}
          max={100}
          value={value}
          onChange={onChange}
        />
        <span className={styles.volume_value}>{value}</span>
      </div>
    </Field>
  );
}

type TabProps = {
  alert: Alert;
  onChange: (alert: Alert) => void;
  onPick: () => void;
};

function SoundTab({
  alert,
  playing,
  play,
  onChange,
  onPick,
}: TabProps & { playing: boolean; play: ReactNode }) {
  const { sound, tts } = alert;

  return (
    <>
      <div className={styles.current}>
        {tts ? (
          <>
            <FiMessageSquare size={18} aria-hidden />
            <span className={styles.current_name}>“{tts.message}”</span>
          </>
        ) : sound ? (
          <>
            <FiMusic size={18} aria-hidden />
            <span className={styles.current_name}>{sound.name}</span>
          </>
        ) : (
          <span className={styles.none}>No sound yet.</span>
        )}
        <span className={styles.current_actions}>
          {/* A sound's goes with its cut */}
          {tts && play}
          <Btn onClick={onPick}>
            {tts || sound ? "Change..." : "Choose sound..."}
          </Btn>
        </span>
      </div>

      {tts ? (
        <p className={styles.note}>
          Spoken with {tts.voice.name}. Messages play whole.
        </p>
      ) : (
        sound && (
          <SoundCut
            sound={sound}
            playing={playing}
            play={play}
            onChange={(cut) =>
              onChange({ ...alert, sound: { ...sound, ...cut } })
            }
          />
        )
      )}

      {(tts || sound) && (
        <Volume
          label="Sound volume"
          value={alert.volume}
          onChange={(volume) => onChange({ ...alert, volume })}
        />
      )}
    </>
  );
}

function MediaTab({ alert, onChange, onPick }: TabProps) {
  const { media } = alert;
  // The video's length in seconds, read by its preview
  const [length, setLength] = useState<{ file: string; seconds: number }>();
  // The file whose preview plays, so another one picked meanwhile doesn't
  const [playing, setPlaying] = useState<string | null>(null);
  const player = useRef<HTMLVideoElement>(null);

  const video = media ? mediaKind(media.file) === "video" : false;
  const read = !!media && length?.file === media.file;
  // Unknown for videos that don't say their length, like some recordings
  const seconds = media && length?.file === media.file ? length.seconds : NaN;
  const cuttable = video && Number.isFinite(seconds) && seconds > 0;
  // A cut video shows while its part plays, an image or a video of unknown
  // length for the duration typed.
  const shows =
    media && cuttable
      ? Math.min(
          Math.max(Math.round(partLength(media, seconds) * 100) / 100, 1),
          MEDIA_MAX_DURATION,
        )
      : null;

  // Also for a video picked or cut while the tab shows
  useEffect(() => {
    if (media && shows !== null && media.duration !== shows) {
      onChange({ ...alert, media: { ...media, duration: shows } });
    }
  }, [shows, media, alert, onChange]);

  // The preview shows the frame where the cut changed.
  const seek = (time: number) => {
    const el = player.current;
    if (!el) return;
    el.pause();
    el.currentTime = time;
  };
  const setCut = (cut: Cut) =>
    media && onChange({ ...alert, media: { ...media, ...cut } });

  return (
    <>
      {/* The file, and beside it what sets how it shows */}
      <div className={styles.media}>
        {media ? (
          <MediaPreview
            key={media.file}
            ref={player}
            media={media}
            playing={playing === media.file}
            onLength={(s) => setLength({ file: media.file, seconds: s })}
            onPlaying={(on) => setPlaying(on ? media.file : null)}
          />
        ) : (
          <span className={styles.preview_empty}>
            <FiImage size={28} aria-hidden />
          </span>
        )}

        <div className={styles.media_details}>
          <div className={styles.current}>
            {media ? (
              <span className={styles.current_name}>{media.name}</span>
            ) : (
              <span className={styles.none}>No media yet.</span>
            )}
            <span className={styles.current_actions}>
              <Btn onClick={onPick}>
                {media ? "Change..." : "Choose media..."}
              </Btn>
            </span>
          </div>

          {/* None while the preview reads the video's length */}
          {media && (!video || (read && !cuttable)) && (
            <Field label="Duration">
              <span className={styles.inline}>
                <NumberInput
                  integer
                  min={1}
                  max={MEDIA_MAX_DURATION}
                  className={styles.number}
                  aria-label="Duration in seconds"
                  value={media.duration}
                  onChange={(duration) =>
                    onChange({ ...alert, media: { ...media, duration } })
                  }
                />
                seconds
              </span>
              <p className={styles.note}>
                At least this long, or while the sound plays if it's longer.
              </p>
            </Field>
          )}

          {media && video && (
            <Volume
              label="Video volume"
              value={media.volume}
              onChange={(volume) =>
                onChange({ ...alert, media: { ...media, volume } })
              }
            />
          )}
        </div>
      </div>

      {media && cuttable && (
        <Field label="Cut">
          <CutTrack
            duration={seconds}
            cut={media}
            playing={playing === media.file}
            actions={
              <span className={styles.cut_actions}>
                <ResetCut
                  cut={media}
                  onChange={(cut) => {
                    seek(0);
                    setCut(cut);
                  }}
                />
              </span>
            }
            onChange={setCut}
            onSeek={seek}
          />
        </Field>
      )}

      <Field label="Overlay URL">
        <CopyField value={getAlertOverlayURL(alert.id)} title="Copy URL" />
      </Field>
    </>
  );
}

const partLength = (cut: Cut, seconds: number) => {
  const { start, stop } = cutPart(cut, seconds);
  return stop - start;
};

/**
 * The alert's image, or its video with a button that plays its cut right
 * here, at the video's volume, and the cut's length.
 */
function MediaPreview({
  media,
  ref,
  playing,
  onLength,
  onPlaying,
}: {
  media: AlertMedia;
  ref: RefObject<HTMLVideoElement | null>;
  playing: boolean;
  onLength: (seconds: number) => void;
  onPlaying: (playing: boolean) => void;
}) {
  const [length, setLength] = useState(NaN);
  // Pauses the video at its cut's end
  const stop = useRef<number>(undefined);
  const { file, volume, start, end } = media;
  const src = useVideoURL(file);

  // The video's clock can lag behind the timer, so it waits for the rest.
  const stopAtEnd = (el: HTMLVideoElement) => {
    if (end === null || el.paused) return;
    const left = end - el.currentTime;
    if (left <= 0.02) el.pause();
    else stop.current = window.setTimeout(() => stopAtEnd(el), left * 1000);
  };

  // Heard as it's set, while it plays
  useEffect(() => {
    if (ref.current) ref.current.volume = volume / 100;
  }, [ref, volume]);

  if (mediaKind(file) !== "video") {
    return (
      <span className={styles.preview}>
        <MediaThumbnail file={file} />
      </span>
    );
  }

  return (
    <span className={styles.preview}>
      <video
        ref={ref}
        className={thumbs.thumb}
        src={`${src}#t=0.1`}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const el = e.currentTarget;
          setLength(el.duration);
          onLength(el.duration);
          // Its first frame is the cut's
          if (start > 0) el.currentTime = start;
        }}
        // Its length unknown, the duration is typed
        onError={() => onLength(NaN)}
        onPlaying={(e) => {
          onPlaying(true);
          window.clearTimeout(stop.current);
          stopAtEnd(e.currentTarget);
        }}
        onPause={() => {
          window.clearTimeout(stop.current);
          onPlaying(false);
        }}
        onEnded={() => onPlaying(false)}
      />
      <Btn
        variant="icon"
        className={styles.preview_play}
        title={playing ? "Pause" : "Play video"}
        onClick={() => {
          const el = ref.current;
          if (!el) return;
          if (!el.paused) {
            el.pause();
            return;
          }
          el.volume = volume / 100;
          // The whole cut, as the alert plays it
          el.currentTime = start;
          el.play().catch(() => onPlaying(false));
        }}
      >
        {playing ? <FiPause size={16} /> : <FiPlay size={16} />}
      </Btn>
      {Number.isFinite(length) && length > 0 && (
        <span className={styles.preview_length}>
          {formatAdded(partLength(media, length) * 1000)}
        </span>
      )}
    </span>
  );
}
