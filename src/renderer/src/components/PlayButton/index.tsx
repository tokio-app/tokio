import { useT } from "@/ui/i18n";
import { FiPlayCircle, FiStopCircle } from "react-icons/fi";
import { Btn, Spinner } from "../Elements";

// Volume of sound previews outside alerts
export const PREVIEW_VOLUME = 100;

// The test loading or playing, `loading` until its audio starts
export type TestState = { id: string; loading: boolean } | null;

// Play button props for the test `id`
export const testProps = (test: TestState, id: string) => ({
  playing: test?.id === id,
  loading: test?.id === id && test.loading,
});

type Props = {
  // The sound is loading or playing
  playing: boolean;
  // The sound is still being generated or downloaded
  loading?: boolean;
  onClick: () => void;
  disabled?: boolean;
  size?: number;
};

/**
 * Plays or stops a sound test. While the sound loads it shows a spinner, and
 * a click cancels it.
 */
export function PlayButton({
  playing,
  loading,
  onClick,
  disabled,
  size = 20,
}: Props) {
  const t = useT();
  let title = t("common.play");
  let icon = <FiPlayCircle size={size} />;
  if (loading) {
    title = t("common.cancel");
    // The spinner's margin makes up the difference, so the row doesn't shift.
    icon = <Spinner size={size - 8} />;
  } else if (playing) {
    title = t("common.stop");
    icon = <FiStopCircle size={size} />;
  }

  return (
    <Btn
      variant="icon"
      active={playing}
      pulse={!loading}
      title={title}
      // Or the spinner's "Loading" would name it
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
    </Btn>
  );
}
