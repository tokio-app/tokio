import { Ref, useMemo, useState } from "react";
import { PropagateLoader } from "react-spinners";
import styles from "./iframe.module.css";

interface IframeProps {
  source: string;
  name: string;
  ref?: Ref<HTMLIFrameElement>;
  onLoad?: () => void;
}

export const Iframe = ({ source, name, ref, onLoad }: IframeProps) => {
  const [loading, setLoading] = useState(true);

  const iframeSrc = useMemo(() => {
    if (!source) return "";

    if (source.startsWith("http://") || source.startsWith("https://")) {
      return source;
    }

    const normalizedPath = source.replace(/\\/g, "/");

    const pathWithSlash = normalizedPath.startsWith("/")
      ? normalizedPath
      : `/${normalizedPath}`;

    // encodeURI leaves # and ? alone, which would cut the path short
    const encoded = encodeURI(pathWithSlash).replace(
      /[#?]/g,
      encodeURIComponent,
    );
    return `local-resource://${encoded}`;
  }, [source]);

  if (!source) {
    return <div>No source provided</div>;
  }

  return (
    <>
      {loading && (
        <div className={styles.loading_container}>
          <PropagateLoader color="var(--accent-primary)" />
        </div>
      )}
      <iframe
        ref={ref}
        src={iframeSrc}
        title={`Viewer for ${name}`}
        name={`TOKIO_APP-${name}`}
        // Off-screen previews don't load or run until scrolled to.
        loading="lazy"
        // Previews ignore the pointer, Tab skips them too
        tabIndex={-1}
        onLoad={() => {
          setLoading(false);
          onLoad?.();
        }}
        className={styles.iframe_component}
        style={{
          visibility: loading ? "hidden" : "visible",
        }}
        sandbox="allow-scripts allow-same-origin"
      />
    </>
  );
};
