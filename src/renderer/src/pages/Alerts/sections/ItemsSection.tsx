import { Alert, Profile, SavedEmote } from "@/common/schemas";
import { CustomGift } from "@/common/types";
import { AlertItem, EmptyState, TestState } from "@/components";
import { AlertTestRequest, Updater } from "@/hooks";
import { useMemo } from "react";
import styles from "../alerts.module.css";
import { emoteOptions } from "../helper";

const COLUMNS = ["Actions", "Enabled", "Trigger", "", "Sound", "Volume"];

type Props = {
  items: Alert[];
  gifts: CustomGift[];
  emotes: SavedEmote[];
  // The sound test loading or playing
  testing: TestState;
  onTest: (req: AlertTestRequest) => void;
  update: Updater<Profile["alerts"]>;
  onPickSound: (id: string) => void;
};

export function ItemsSection({
  items,
  gifts,
  emotes,
  testing,
  onTest,
  update,
  onPickSound,
}: Props) {
  const emoteChoices = useMemo(() => emoteOptions(emotes), [emotes]);

  return (
    <div className={styles.items}>
      <div className={styles.columns}>
        {COLUMNS.map((column, index) => (
          <span key={index} className={styles.column}>
            {column}
          </span>
        ))}
      </div>

      {items.length === 0 ? (
        <EmptyState>
          No alerts yet. Use the add button to create one.
        </EmptyState>
      ) : (
        items.map((alert) => (
          <AlertItem
            key={alert.id}
            alert={alert}
            gifts={gifts}
            emotes={emoteChoices}
            testing={testing}
            onTest={onTest}
            onChange={(changed) =>
              update((s) => {
                const index = s.items.findIndex((a) => a.id === changed.id);
                if (index !== -1) s.items[index] = changed;
              })
            }
            onRemove={() =>
              update((s) => {
                s.items = s.items.filter((a) => a.id !== alert.id);
              })
            }
            onPickSound={() => onPickSound(alert.id)}
          />
        ))
      )}
    </div>
  );
}
