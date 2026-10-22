import Logo from "@/assets/logo.png";
import { Spinner } from "@/components/Elements/Spinner";
import styles from "./splash.module.css";

export function SplashScreen() {
  return (
    <div className={styles.container}>
      <div className={styles.glow_wrapper}>
        <div className={styles.content}>
          <div className={styles.logo}>
            <img src={Logo} alt="Tokio" />
          </div>
          <div className={styles.app_name}>
            <h1>Tok</h1>
            <h1 className={styles.accent_red}>io</h1>
          </div>

          <div className={styles.loading}>
            <Spinner size={20} />
            <span className={styles.status_text}>Starting up...</span>
          </div>
        </div>
      </div>

      <div className={styles.footer}>
        <span className={styles.version}>v{__APP_VERSION__}</span>
        <span className={styles.disclaimer}>
          Not affiliated with, endorsed by, or associated with TikTok or
          ByteDance Ltd.
        </span>
      </div>
    </div>
  );
}
