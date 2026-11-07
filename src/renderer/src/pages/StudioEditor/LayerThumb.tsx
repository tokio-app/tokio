import { StudioCrop, StudioElement } from "@/common/schemas";
import { CustomGift } from "@/common/types";
import { MediaThumbnail } from "@/components";
import { useT } from "@/ui/i18n";
import { CSSProperties } from "react";
import { IconType } from "react-icons";
import {
  LuAppWindow,
  LuCircleUserRound,
  LuGift,
  LuImage,
  LuSmile,
} from "react-icons/lu";
import styles from "./studioeditor.module.css";

// The px a shape's miniature takes on its longer side
const SHAPE_PX = 18;

/**
 * What a layer's row shows of it, on the canvas's own color: its picture,
 * its shape in miniature in its colors, or its text's font and color. What
 * only the stream knows (the gift or emote a viewer sends, a viewer's
 * picture, an embedded overlay) is an icon.
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
          }}
        >
          {t("studio.editor.textSample")}
        </span>
      );
    case "shape": {
      const scale = SHAPE_PX / Math.max(element.width, element.height);
      return (
        <span className={styles.thumb} aria-hidden>
          <span
            className={styles.thumb_shape}
            style={{
              width: Math.max(2, element.width * scale),
              height: Math.max(2, element.height * scale),
              borderRadius: element.radius * scale,
              backgroundColor: element.fill ? element.color : "transparent",
              border: element.border
                ? `${Math.max(1, element.border_width * scale)}px solid ${element.border_color}`
                : undefined,
            }}
          />
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
    case "viewer":
      return icon(LuCircleUserRound);
    // An embedded overlay
    default:
      return icon(LuAppWindow);
  }
}
