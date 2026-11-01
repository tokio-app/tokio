import { useState } from "react";
import styles from "./avatar.module.css";

// Splits a name into what shows as one character, a flag or emoji included
const characters = new Intl.Segmenter();

type Props = {
  name: string;
  // Empty when TikTok sent none
  picture: string;
};

// A viewer's picture, or their initial when there's none or its link expired
export function Avatar({ name, picture }: Props) {
  const [failed, setFailed] = useState("");
  if (picture && picture !== failed) {
    return (
      <img
        className={styles.avatar}
        src={picture}
        alt=""
        loading="lazy"
        onError={() => setFailed(picture)}
      />
    );
  }
  const [initial] = characters.segment(name);
  return (
    <span className={styles.avatar} aria-hidden="true">
      {initial?.segment.toUpperCase()}
    </span>
  );
}
