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
import { ReactNode, useEffect, useRef, useState } from "react";
import {
  FiImage,
  FiMessageSquare,
  FiMusic,
  FiPause,
  FiPlay,
  FiVolume2,
} from "react-icons/fi";
import styles from "./editor.module.css";
import { SoundCut } from "./SoundCut";

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
 * Edits an alert: what sets it off, what it plays and how much of it, and
 * what it shows. Changes save as they're made.
 */
export function AlertEditor({
  alert,
  gifts,
  emotes,
  testing,
  onTest,
  onChange,
  onPickSound,
  onPickMedia,
  onClose,
}: Props) {
  const [tab, setTab] = useState<Tab>("trigger");
  const test = alertTest(alert);

  return (
    <Modal
      title={`${ALERT_TRIGGER_LABELS[alert.trigger.type]} alert`}
      maxWidth="720px"
      onClose={onClose}
      footer={
        <Btn variant="accent" onClick={onClose}>
          Done
        </Btn>
      }
    >
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
  const filter = FILTER_LABELS[trigger.type];
  const { roles } = trigger;

  return (
    <>
      <Field label="Event">
        <Select
          aria-label="Event"
          options={TRIGGER_OPTIONS}
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
                label={ROLE_NAMES[role]}
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

  const video = media ? mediaKind(media.file) === "video" : false;
  // Unknown for videos that don't say their length, like some recordings
  const seconds = media && length?.file === media.file ? length.seconds : NaN;
  // Rounded up from the tenths the preview's length shows, so a 6.02s video
  // is 6 seconds, as it reads
  const match = Number.isFinite(seconds)
    ? Math.min(Math.ceil(Math.round(seconds * 10) / 10), MEDIA_MAX_DURATION)
    : null;
  // The duration follows the video, also one picked after it was matched.
  const following = !!media?.match_video && video && match !== null;

  useEffect(() => {
    if (following && media && match !== null && media.duration !== match) {
      onChange({ ...alert, media: { ...media, duration: match } });
    }
  }, [following, match, media, alert, onChange]);

  return (
    <>
      {/* The file, and beside it what sets how it shows */}
      <div className={styles.media}>
        {media ? (
          <MediaPreview
            key={media.file}
            media={media}
            onLength={(s) => setLength({ file: media.file, seconds: s })}
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

          {media && (
            <Field label="Duration">
              <span className={styles.inline}>
                <NumberInput
                  integer
                  min={1}
                  max={MEDIA_MAX_DURATION}
                  className={styles.number}
                  aria-label="Duration in seconds"
                  value={media.duration}
                  disabled={following}
                  onChange={(duration) =>
                    onChange({ ...alert, media: { ...media, duration } })
                  }
                />
                seconds
                {video && (
                  <Check
                    label="Match video"
                    title={`The video's length, up to ${MEDIA_MAX_DURATION} seconds`}
                    checked={media.match_video}
                    // Off, a video of unknown length can't be matched
                    disabled={!media.match_video && match === null}
                    onChange={(e) =>
                      onChange({
                        ...alert,
                        media: { ...media, match_video: e.target.checked },
                      })
                    }
                  />
                )}
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

      <Field label="Overlay URL">
        <CopyField value={getAlertOverlayURL(alert.id)} title="Copy URL" />
      </Field>
    </>
  );
}

/**
 * The alert's image, or its video with a button that plays it right here,
 * at the video's volume, and its length.
 */
function MediaPreview({
  media,
  onLength,
}: {
  media: AlertMedia;
  onLength: (seconds: number) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [length, setLength] = useState(NaN);
  const { file, volume } = media;
  const src = useVideoURL(file);

  // Heard as it's set, while it plays
  useEffect(() => {
    if (ref.current) ref.current.volume = volume / 100;
  }, [volume]);

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
          setLength(e.currentTarget.duration);
          onLength(e.currentTarget.duration);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
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
          el.play().catch(() => setPlaying(false));
        }}
      >
        {playing ? <FiPause size={16} /> : <FiPlay size={16} />}
      </Btn>
      {Number.isFinite(length) && length > 0 && (
        <span className={styles.preview_length}>
          {formatAdded(length * 1000)}
        </span>
      )}
    </span>
  );
}
