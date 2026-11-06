import { useNavigate } from "@tanstack/react-router";
import { LuArrowLeft } from "react-icons/lu";
import { Btn } from "../Elements";
import styles from "./backbutton.module.css";

interface Props {
  // The page that opens this one
  to: "/overlays" | "/tools" | "/tools/studio";
  title: string;
}

/**
 * The arrow before the title of a page opened from another page. It goes to
 * that page, not back through the history.
 */
export function BackButton({ to, title }: Props) {
  const navigate = useNavigate();
  return (
    <Btn
      variant="icon"
      title={title}
      className={styles.back}
      onClick={() => navigate({ to })}
    >
      <LuArrowLeft size={22} />
    </Btn>
  );
}
