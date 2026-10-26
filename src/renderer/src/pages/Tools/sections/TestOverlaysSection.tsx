import { TestOverlay } from "@/common/schemas";
import { getOverlaySocketURL } from "@/common/util";
import { Btn, CopyField, EmptyState, Input, Section } from "@/components";
import { useState } from "react";
import { FiTrash2 } from "react-icons/fi";
import { LuPlus } from "react-icons/lu";
import { PiShootingStarThin } from "react-icons/pi";
import { STATUS_LABELS, TestStatus } from "../helper";
import styles from "../tools.module.css";

interface Props {
  overlays: TestOverlay[];
  statuses: Record<string, TestStatus>;
  onCreate: (name: string) => void;
  onRemove: (id: string) => void;
  onTest: (id: string) => void;
}

export function TestOverlaysSection({
  overlays,
  statuses,
  onCreate,
  onRemove,
  onTest,
}: Props) {
  const [name, setName] = useState("");

  return (
    <Section
      title="Test Overlays"
      description="Send test events to an overlay you're building."
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
          placeholder="Overlay name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Btn type="submit" disabled={!name.trim()} title="Create ID">
          <LuPlus size={20} />
        </Btn>
      </form>

      {overlays.length > 0 ? (
        <div className={styles.list}>
          {overlays.map((overlay) => (
            <div key={overlay.id} className={styles.item}>
              <div className={styles.item_header}>
                <h3 className={styles.item_name}>{overlay.name}</h3>
                <div className={styles.row}>
                  <Btn onClick={() => onTest(overlay.id)}>
                    <PiShootingStarThin size={20} />
                    Test
                  </Btn>
                  <Btn title="Delete" onClick={() => onRemove(overlay.id)}>
                    <FiTrash2 size={18} />
                  </Btn>
                </div>
              </div>

              {/* One a line: side by side they can't shrink and overflow */}
              <CopyField value={overlay.id} title="Copy ID" />
              <CopyField
                value={getOverlaySocketURL(overlay.id)}
                title="Copy WebSocket URL"
              />

              {statuses[overlay.id] && (
                <p className={styles.test_status}>
                  {STATUS_LABELS[statuses[overlay.id]]}
                </p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState>No test overlays yet.</EmptyState>
      )}
    </Section>
  );
}
