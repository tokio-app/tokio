import { EULER_SIGNUP_URL } from "@/common/util";
import { rich, useT } from "@/ui/i18n";
import { useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Btn } from "../Elements";
import { Modal } from "../Modal";
import { placeTour, TOUR_STEPS, type TourPlace } from "./helper";
import styles from "./tour.module.css";

type Props = {
  onClose: () => void;
};

/**
 * Shows the window one piece at a time, the sidebar's pages and then Home's
 * switches and connect box, each lit with a card beside it.
 */
export function Tour({ onClose }: Props) {
  const t = useT();
  const [index, setIndex] = useState(0);
  // Whether the step's piece was found, with where it and the card go
  const [place, setPlace] = useState<TourPlace & { lit: boolean }>();
  const nextRef = useRef<HTMLButtonElement>(null);

  const step = TOUR_STEPS[index];
  const last = index === TOUR_STEPS.length - 1;

  // Before it's painted, and again when the window's size changes.
  // shortcut: doesn't scroll a piece into view, since Home's fit the 1200×800
  // minimum window; scroll it in if a step ever shows something lower.
  useLayoutEffect(() => {
    const measure = () => {
      const piece =
        step.target && document.querySelector(`[data-tour="${step.target}"]`);
      setPlace({
        ...placeTour(
          piece ? piece.getBoundingClientRect() : undefined,
          window.innerWidth,
          window.innerHeight,
        ),
        lit: !!piece,
      });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [step]);

  const back = () => {
    // Back leaves with the second step, and Chromium drops its focus on <body>
    flushSync(() => setIndex(index - 1));
    if (index === 1) nextRef.current?.focus();
  };

  // Placed before it's shown: Next's autoFocus reads the card's style, so a
  // card placed after it would glide in from the window's center
  if (!place) return null;

  return (
    <>
      <div
        className={styles.spotlight}
        style={place.hole}
        data-lit={place.lit || undefined}
        aria-hidden
      />
      <Modal
        title={t(step.title)}
        description={
          // Read out as each step comes
          <span className={styles.text} aria-live="polite">
            {rich(t(step.text), {
              link: (text) => (
                <a href={EULER_SIGNUP_URL} target="_blank" rel="noreferrer">
                  {text}
                </a>
              ),
            })}
          </span>
        }
        onClose={onClose}
        closeButton
        maxWidth="340px"
        at={place.card}
        footer={
          <>
            <span className={styles.count}>
              {t("components.tour.step", {
                step: String(index + 1),
                total: String(TOUR_STEPS.length),
              })}
            </span>
            {index > 0 && <Btn onClick={back}>{t("components.tour.back")}</Btn>}
            <Btn
              ref={nextRef}
              variant="accent"
              autoFocus
              onClick={last ? onClose : () => setIndex(index + 1)}
            >
              {last ? t("common.done") : t("components.tour.next")}
            </Btn>
          </>
        }
      />
    </>
  );
}
