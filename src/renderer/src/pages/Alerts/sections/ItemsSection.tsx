import { Alert, Profile } from "@/common/schemas";
import { CustomGift } from "@/common/types";
import { alertName } from "@/common/util";
import { AlertItem, EmoteOption, EmptyState, TestState } from "@/components";
import { AlertTestRequest, Updater } from "@/hooks";
import { useT } from "@/ui/i18n";
import styles from "../alerts.module.css";

type Props = {
  items: Alert[];
  // Shows only the alerts whose names have it
  search: string;
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
  search,
  gifts,
  emotes,
  testing,
  onTest,
  update,
  onEdit,
}: Props) {
  const t = useT();
  const needle = search.trim().toLowerCase();
  // Each keeps its place in the list, which its default name counts
  const shown = items
    .map((alert, index) => ({ alert, index }))
    .filter(({ alert, index }) =>
      alertName(alert.name, index).toLowerCase().includes(needle),
    );

  return (
    <div className={styles.items}>
      {shown.length === 0 ? (
        <EmptyState>
          {t(items.length > 0 ? "alerts.items.notFound" : "alerts.items.empty")}
        </EmptyState>
      ) : (
        shown.map(({ alert, index }) => (
          <AlertItem
            key={alert.id}
            alert={alert}
            index={index}
            gifts={gifts}
            emotes={emotes}
            testing={testing}
            onTest={onTest}
            onChange={(changed) =>
              update((s) => {
                const at = s.items.findIndex((a) => a.id === changed.id);
                if (at !== -1) s.items[at] = changed;
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
