import { TestOverlay } from "@/common/schemas";
import { getOverlaySocketURL } from "@/common/util";
import {
  BackButton,
  Btn,
  CopyField,
  EmptyState,
  Input,
  Section,
  useFocusAfterDelete,
} from "@/components";
import { useT } from "@/ui/i18n";
import { useRef, useState } from "react";
import { FiTrash2 } from "react-icons/fi";
import { LuPlus } from "react-icons/lu";
import { PiShootingStarThin } from "react-icons/pi";
import { STATUS_LABELS, TestStatus } from "../helper";
import styles from "../testoverlays.module.css";

interface Props {
  overlays: TestOverlay[];
  statuses: Record<string, TestStatus>;
  onCreate: (name: string) => void;
  // Asks first
  onRemove: (overlay: TestOverlay) => void;
  onTest: (id: string) => void;
}

export function TestOverlaysSection({
  overlays,
  statuses,
  onCreate,
  onRemove,
  onTest,
}: Props) {
  const t = useT();
  const [name, setName] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const deleted = useFocusAfterDelete(
    overlays.map((overlay) => overlay.id),
    list,
    nameRef,
  );

  return (
    <Section
      icon={<BackButton to="/tools" title={t("tools.back")} />}
      title={t("tools.test.title")}
      description={t("tools.test.description")}
    >
      <form
        className={styles.row}
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          onCreate(name);
          setName("");
        }}
      >
        <Input
          ref={nameRef}
          placeholder={t("tools.test.name")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Btn
          type="submit"
          disabled={!name.trim()}
          title={t("tools.test.create")}
        >
          <LuPlus size={20} />
        </Btn>
      </form>

      {overlays.length > 0 ? (
        <div ref={list} className={styles.list}>
          {overlays.map((overlay, at) => (
            <div key={overlay.id} className={styles.item}>
              <div className={styles.item_header}>
                <h3 className={styles.item_name}>{overlay.name}</h3>
                <div className={styles.row}>
                  <Btn onClick={() => onTest(overlay.id)}>
                    <PiShootingStarThin size={20} />
                    {t("common.test")}
                  </Btn>
                  <Btn
                    title={t("common.delete")}
                    onClick={() => {
                      deleted(overlay.id, at);
                      onRemove(overlay);
                    }}
                  >
                    <FiTrash2 size={18} />
                  </Btn>
                </div>
              </div>

              {/* One a line: side by side they can't shrink and overflow */}
              <CopyField value={overlay.id} title={t("tools.test.copyId")} />
              <CopyField
                value={getOverlaySocketURL(overlay.id)}
                title={t("tools.test.copyUrl")}
              />

              {statuses[overlay.id] && (
                <p className={styles.test_status}>
                  {t(STATUS_LABELS[statuses[overlay.id]])}
                </p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState>{t("tools.test.empty")}</EmptyState>
      )}
    </Section>
  );
}
