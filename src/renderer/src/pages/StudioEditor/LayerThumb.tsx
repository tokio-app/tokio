import { StudioCrop, StudioElement, StudioListSource } from "@/common/schemas";
import { shapePath } from "@/common/studio/stage";
import { CustomGift } from "@/common/types";
import { SAMPLE_FILL } from "@/common/util";
import { MediaThumbnail } from "@/components";
import { useT } from "@/ui/i18n";
import { CSSProperties } from "react";
import { IconType } from "react-icons";
import {
  LuAppWindow,
  LuCircleUserRound,
  LuGift,
  LuHeartHandshake,
  LuImage,
  LuMessagesSquare,
  LuSmile,
  LuTrophy,
  LuUserPlus,
  LuWebcam,
} from "react-icons/lu";
import styles from "./studioeditor.module.css";

// A list's icon, by what it lists
const LIST_ICONS: Record<StudioListSource, IconType> = {
  gifters: LuTrophy,
  giftsubs: LuHeartHandshake,
  followers: LuUserPlus,
  gifts: LuGift,
  chat: LuMessagesSquare,
};

// The px a shape's miniature takes on its longer side
const SHAPE_PX = 18;
// A speech bubble's shorter side at least: flatter, its border and tail
// drew a flat bar
const BUBBLE_PX = 10;

/**
 * What a layer's row shows of it, on the canvas's own color: its picture,
 * its shape or goal bar in miniature in its colors, or its text's font and
 * color. What only the stream knows (the gift or emote a viewer sends, a
 * viewer's picture, an embedded overlay) is an icon.
 */
export function LayerThumb({
  element,
  gifts,
}: {
  element: StudioElement;
  gifts: CustomGift[];
}) {
  const t = useT();
  const icon = (Icon: IconType) => (
    <span className={styles.thumb} aria-hidden>
      <Icon size={16} />
    </span>
  );
  // A picture's part it keeps, as its thumbnail shows it
  const kept = (crop: StudioCrop): CSSProperties | undefined =>
    crop.left || crop.top || crop.right || crop.bottom
      ? {
          objectViewBox: `inset(${crop.top * 100}% ${crop.right * 100}% ${crop.bottom * 100}% ${crop.left * 100}%)`,
        }
      : undefined;
  const picture = (src: string, crop: StudioCrop) => (
    <span className={styles.thumb} aria-hidden>
      <img src={src} alt="" loading="lazy" style={kept(crop)} />
    </span>
  );

  switch (element.kind) {
    case "text":
      return (
        <span
          className={styles.thumb}
          aria-hidden
          style={{
            color: element.color,
            fontFamily: element.font ? JSON.stringify(element.font) : undefined,
            fontWeight: element.bold ? 700 : 400,
            fontStyle: element.italic ? "italic" : undefined,
            textTransform: element.caps ? "uppercase" : undefined,
          }}
        >
          {t("studio.editor.textSample")}
        </span>
      );
    case "shape": {
      const { shape } = element;
      const scale = SHAPE_PX / Math.max(element.width, element.height);
      const least = shape === "bubble" ? BUBBLE_PX : 2;
      const width = Math.max(least, element.width * scale);
      const height = Math.max(least, element.height * scale);
      const border = Math.max(1, element.border_width * scale);
      const gradient =
        element.fill && element.gradient
          ? `linear-gradient(${element.gradient_angle}deg, ${element.color}, ${element.gradient_color})`
          : undefined;
      if (shape === "rectangle" || shape === "ellipse") {
        return (
          <span className={styles.thumb} aria-hidden>
            <span
              className={styles.thumb_shape}
              style={{
                width,
                height,
                borderRadius:
                  shape === "ellipse" ? "50%" : element.radius * scale,
                background:
                  gradient ?? (element.fill ? element.color : "transparent"),
                border: element.border
                  ? `${border}px solid ${element.border_color}`
                  : undefined,
              }}
            />
          </span>
        );
      }
      // As the stage draws it: a stroke at twice the width, cut to the shape
      const d = shapePath(shape, width, height, {
        ...element,
        radius: element.radius * scale,
      });
      return (
        <span className={styles.thumb} aria-hidden>
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            style={{ clipPath: `path("${d}")`, background: gradient }}
          >
            <path
              d={d}
              fill={element.fill && !gradient ? element.color : "none"}
              stroke={element.border ? element.border_color : "none"}
              strokeWidth={element.border ? border * 2 : 0}
            />
          </svg>
        </span>
      );
    }
    case "media":
      return element.file ? (
        <span className={styles.thumb} aria-hidden>
          <MediaThumbnail file={element.file} style={kept(element.crop)} />
        </span>
      ) : (
        icon(LuImage)
      );
    case "gift": {
      const image = gifts.find((gift) => gift.value === element.gift)?.img;
      return image ? picture(image, element.crop) : icon(LuGift);
    }
    case "emote":
      return element.emote
        ? picture(element.emote.image, element.crop)
        : icon(LuSmile);
    // A live thumbnail would open another stream
    case "camera":
      return icon(LuWebcam);
    case "viewer":
      return icon(LuCircleUserRound);
    case "bar": {
      // Thick enough to see its fill, which shows as the canvas's sample
      const scale = SHAPE_PX / Math.max(element.width, element.height);
      const width = Math.max(4, element.width * scale);
      const height = Math.max(4, element.height * scale);
      const length = `${SAMPLE_FILL * 100}%`;
      return (
        <span className={styles.thumb} aria-hidden>
          <span
            className={styles.thumb_bar}
            style={{
              width,
              height,
              borderRadius: (element.rounding / 100) * Math.min(width, height),
              background: element.track,
            }}
          >
            <span
              style={{
                width: element.vertical ? "100%" : length,
                height: element.vertical ? length : "100%",
                background: element.gradient
                  ? `linear-gradient(${element.gradient_angle}deg, ${element.color}, ${element.gradient_color}) 0 100% / ${width}px ${height}px`
                  : element.color,
              }}
            />
          </span>
        </span>
      );
    }
    case "list":
      return icon(LIST_ICONS[element.source]);
    // An embedded overlay
    default:
      return icon(LuAppWindow);
  }
}
