import {
  STUDIO_CAMERA_MAX_LENGTH,
  STUDIO_CAMERA_QUALITIES,
  StudioElement,
  StudioElementOf,
} from "@/common/schemas";
import { Field, Select } from "@/components";
import { useOptions, useT } from "@/ui/i18n";
import { useEffect, useState } from "react";

const QUALITIES = STUDIO_CAMERA_QUALITIES.map((value) => ({
  value,
  label: `studio.camera.qualities.${value}` as const,
}));

// The saved camera's option while the system doesn't list it. No camera's
// id has a colon.
const MISSING = "missing:";

type Props = {
  element: StudioElementOf<"camera">;
  onChange: (element: StudioElement) => void;
};

/**
 * A camera element's camera, from the ones this computer has, and its
 * quality.
 */
export function CameraFields({ element, onChange }: Props) {
  const t = useT();
  const qualities = useOptions(QUALITIES);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    const devices = navigator.mediaDevices;
    let mounted = true;
    const list = () =>
      void devices.enumerateDevices().then((all) => {
        if (!mounted) return;
        // One without an id is a camera the window may not see yet
        setCameras(all.filter((d) => d.kind === "videoinput" && d.deviceId));
      });
    list();
    devices.addEventListener("devicechange", list);
    return () => {
      mounted = false;
      devices.removeEventListener("devicechange", list);
    };
  }, []);

  // Ids are per origin, so a camera saved in another build shows by its name
  const { camera } = element;
  const shown =
    camera &&
    (cameras.find((d) => d.deviceId === camera.id) ??
      (camera.label ? cameras.find((d) => d.label === camera.label) : null));
  const options = [
    { value: "", label: t("studio.camera.default") },
    ...(camera && !shown
      ? [
          {
            value: MISSING,
            label: t("studio.camera.missing", { name: camera.label }),
          },
        ]
      : []),
    ...cameras.map((d) => ({ value: d.deviceId, label: d.label })),
  ];

  return (
    <>
      <Field label={t("studio.fields.camera")}>
        <Select
          aria-label={t("studio.fields.camera")}
          options={options}
          value={!camera ? "" : shown ? shown.deviceId : MISSING}
          onChange={(id) => {
            if (id === MISSING) return;
            const picked = cameras.find((d) => d.deviceId === id);
            onChange({
              ...element,
              camera: picked
                ? {
                    id: picked.deviceId.slice(0, STUDIO_CAMERA_MAX_LENGTH),
                    label: picked.label.slice(0, STUDIO_CAMERA_MAX_LENGTH),
                  }
                : null,
            });
          }}
        />
      </Field>
      <Field label={t("studio.fields.quality")}>
        <Select
          aria-label={t("studio.fields.quality")}
          options={qualities}
          value={element.quality}
          onChange={(quality) => onChange({ ...element, quality })}
        />
      </Field>
    </>
  );
}
