import {
  getOverlayConfig,
  OverlayConfig,
  resetOverlayConfig,
} from "@/common/schemas";
import { CustomGift, OverlayApp, TokioPreviewMessage } from "@/common/types";
import { useT } from "@/ui/i18n";
import { useEffect, useRef, useState } from "react";
import { PiShootingStarThin } from "react-icons/pi";
import { Btn, Spinner } from "../Elements";
import { Modal } from "../Modal";
import { OverlayPreview } from "../OverlayPreview";
import styles from "./overlaymodal.module.css";
import { sameValue, SettingField } from "./SettingField";

interface Props {
  overlay: OverlayApp;
  config: OverlayConfig | null;
  gifts: CustomGift[];
  // Waiting for main to save the config
  saving: boolean;
  onRequestClose: () => void;
  onSave: (config: OverlayConfig) => void;
  // Plays sample events in the previews
  onTest: () => void;
}

export function OverlayModal({
  overlay,
  config,
  gifts,
  saving,
  onRequestClose,
  onSave,
  onTest,
}: Props) {
  const t = useT();
  const [settings, setSettings] = useState<OverlayConfig | null>(config);
  const [prevConfig, setPrevConfig] = useState(config);
  const preview = useRef<HTMLIFrameElement>(null);
  const [previewReady, setPreviewReady] = useState(false);

  // Load the config once it arrives.
  if (config !== prevConfig) {
    setPrevConfig(config);
    setSettings(config);
  }

  // Only this preview shows the unsaved settings. The gallery and the live
  // overlays get them on save.
  useEffect(() => {
    if (!previewReady || settings == null) return;
    const message: TokioPreviewMessage = {
      action: "TOKIO_PREVIEW",
      payload: {
        type: "tokio:config",
        data: getOverlayConfig(settings, gifts),
      },
    };
    preview.current?.contentWindow?.postMessage(message, "*");
  }, [previewReady, settings, gifts]);

  const fields = settings?.fields ?? [];
  const dirty =
    config != null &&
    fields.some(
      (field, i) =>
        !sameValue(field.attributes.value, config.fields[i]?.attributes.value),
    );
  const atDefaults = fields.every((field) =>
    sameValue(field.attributes.value, field.attributes.default),
  );

  const handleValueChange = (id: string, value: unknown) => {
    setSettings((prev) => {
      if (prev == null) return prev;
      return {
        ...prev,
        fields: prev.fields.map((field) => {
          if (field.id !== id) return field;
          const changed = structuredClone(field);
          // Each control gives a value of its field's type.
          Object.assign(changed.attributes, { value });
          return changed;
        }),
      };
    });
  };

  return (
    <Modal
      title={overlay.name}
      maxWidth="1040px"
      closeButton
      onClose={onRequestClose}
      footer={
        <div className={styles.footer}>
          <Btn
            disabled={settings == null || atDefaults}
            onClick={() =>
              setSettings((prev) =>
                prev == null ? prev : resetOverlayConfig(prev),
              )
            }
          >
            {t("components.overlayModal.resetAll")}
          </Btn>
          <div className={styles.footer_actions}>
            <Btn onClick={onRequestClose}>{t("common.cancel")}</Btn>
            <Btn
              variant="accent"
              disabled={!dirty}
              loading={saving}
              onClick={() => {
                if (settings != null) onSave(settings);
              }}
            >
              {t("common.save")}
            </Btn>
          </div>
        </div>
      }
    >
      <div className={styles.editor}>
        <div className={styles.preview}>
          <OverlayPreview
            ref={preview}
            overlay={overlay}
            onLoad={() => setPreviewReady(true)}
          />
          <div className={styles.preview_actions}>
            <Btn onClick={onTest}>
              <PiShootingStarThin size={18} />
              {t("common.test")}
            </Btn>
            <p className={styles.note}>{t("components.overlayModal.note")}</p>
          </div>
        </div>

        {settings == null ? (
          <div className={styles.loading}>
            <Spinner size={32} />
          </div>
        ) : (
          <div className={styles.settings}>
            {settings.sections.map((section) => {
              const sectionFields = fields.filter(
                (field) => field.section === section.id,
              );
              if (sectionFields.length === 0) return null;

              return (
                <fieldset key={section.id} className={styles.group}>
                  <legend className={styles.group_name}>{section.name}</legend>
                  {sectionFields.map((field) => (
                    <SettingField
                      key={field.id}
                      field={field}
                      gifts={gifts}
                      onChange={(value) => handleValueChange(field.id, value)}
                      onReset={() =>
                        handleValueChange(
                          field.id,
                          structuredClone(field.attributes.default),
                        )
                      }
                    />
                  ))}
                </fieldset>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
