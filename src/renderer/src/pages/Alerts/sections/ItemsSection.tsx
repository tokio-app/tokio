import { Alert, Profile } from "@/common/schemas";
import { CustomGift } from "@/common/types";
import { AlertItem, EmoteOption, EmptyState, TestState } from "@/components";
import { AlertTestRequest, Updater } from "@/hooks";
import styles from "../alerts.module.css";

type Props = {
  items: Alert[];
  // TikTok's gifts and the ones seen in LIVEs, see giftOptions
  gifts: CustomGift[];
  emotes: EmoteOption[];
  // The sound test loading or playing
  testing: TestState;
  onTest: (req: AlertTestRequest) => void;
  update: Updater<Profile["alerts"]>;
  onEdit: (id: string) => void;
};

export function ItemsSection({
  items,
  gifts,
  emotes,
  testing,
  onTest,
  update,
  onEdit,
}: Props) {
  return (
    <div className={styles.items}>
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
            emotes={emotes}
            testing={testing}
            onTest={onTest}
            onChange={(changed) =>
              update((s) => {
                const index = s.items.findIndex((a) => a.id === changed.id);
                if (index !== -1) s.items[index] = changed;
              })
            }
            onEdit={() => onEdit(alert.id)}
            onRemove={() =>
              update((s) => {
                s.items = s.items.filter((a) => a.id !== alert.id);
              })
            }
          />
        ))
      )}
    </div>
  );
}
