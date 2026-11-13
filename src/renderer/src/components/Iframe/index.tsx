import { PREVIEW_READY } from "@/common/util";
import { useT } from "@/ui/i18n";
import {
  Ref,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Spinner } from "../Elements";
import styles from "./iframe.module.css";

interface IframeProps {
  source: string;
  name: string;
  ref?: Ref<HTMLIFrameElement>;
  // Without the app's background behind it, for an overlay drawn over
  // others in Overlay Studio: main skips it for ?transparent
  transparent?: boolean;
  onLoad?: () => void;
}

export const Iframe = ({
  source,
  name,
  ref,
  transparent,
  onLoad,
}: IframeProps) => {
  const t = useT();
  const [loading, setLoading] = useState(true);
  const frame = useRef<HTMLIFrameElement>(null);
  useImperativeHandle(ref, () => frame.current!, []);

  const loaded = () => {
    setLoading(false);
    onLoad?.();
  };

  // Main's script in the page posts this once the overlay's own scripts have
  // run. Its load also waits for pictures from other hosts, which can hang.
  const onReady = useEffectEvent(loaded);
  useEffect(() => {
    const ready = (e: MessageEvent) => {
      if (e.data === PREVIEW_READY && e.source === frame.current?.contentWindow)
        onReady();
    };
    window.addEventListener("message", ready);
    return () => window.removeEventListener("message", ready);
  }, []);

  const iframeSrc = useMemo(() => {
    const normalizedPath = source.replace(/\\/g, "/");

    const pathWithSlash = normalizedPath.startsWith("/")
      ? normalizedPath
      : `/${normalizedPath}`;

    // encodeURI leaves # and ? alone, which would cut the path short
    const encoded = encodeURI(pathWithSlash).replace(
      /[#?]/g,
      encodeURIComponent,
    );
    return `local-resource://${encoded}${transparent ? "?transparent" : ""}`;
  }, [source, transparent]);

  return (
    <>
      {loading && (
        <div className={styles.loading_container}>
          <Spinner size={24} />
        </div>
      )}
      <iframe
        ref={frame}
        src={iframeSrc}
        title={t("components.iframe.title", { name })}
        name={`TOKIO_APP-${name}`}
        // Off-screen previews don't load or run until scrolled to.
        loading="lazy"
        // Previews ignore the pointer, Tab skips them too
        tabIndex={-1}
        onLoad={loaded}
        className={styles.iframe_component}
        style={{
          visibility: loading ? "hidden" : "visible",
        }}
        sandbox="allow-scripts allow-same-origin"
      />
    </>
  );
};
