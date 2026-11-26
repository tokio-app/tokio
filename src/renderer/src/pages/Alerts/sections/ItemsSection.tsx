import { Alert, Profile } from "@/common/schemas";
import { CustomGift } from "@/common/types";
import { alertName } from "@/common/util";
import {
  AlertItem,
  DeleteAlertModal,
  EmoteOption,
  EmptyState,
  TestState,
  useFocusAfterDelete,
} from "@/components";
import { AlertTestRequest, Updater } from "@/hooks";
import { useT } from "@/ui/i18n";
import { RefObject, useRef, useState } from "react";
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
  // Takes the focus when the last alert is deleted
  addRef: RefObject<HTMLButtonElement | null>;
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
  addRef,
}: Props) {
  const t = useT();
  const list = useRef<HTMLDivElement>(null);
  // The alert waiting for the user to confirm it's deleted, by its place in
  // the rows shown
  const [deleting, setDeleting] = useState<{
    id: string;
    name: string;
    at: number;
  } | null>(null);
  const needle = search.trim().toLowerCase();
  // Each keeps its place in the list, which its default name counts
  const shown = items
    .map((alert, index) => ({ alert, index }))
    .filter(({ alert, index }) =>
      alertName(alert.name, index).toLowerCase().includes(needle),
    );
  const deleted = useFocusAfterDelete(
    items.map((alert) => alert.id),
    list,
    addRef,
  );

  return (
    <>
      {/* On the page, as the other pages' empty lists */}
      {shown.length === 0 ? (
        <EmptyState>
          {t(items.length > 0 ? "alerts.items.notFound" : "alerts.items.empty")}
        </EmptyState>
      ) : (
        <div ref={list} className={styles.items}>
          {shown.map(({ alert, index }, place) => (
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
                setDeleting({
                  id: alert.id,
                  name: alertName(alert.name, index),
                  at: place,
                })
              }
            />
          ))}
        </div>
      )}
      {deleting && (
        <DeleteAlertModal
          item={deleting}
          onClose={() => setDeleting(null)}
          onDelete={() => {
            const { id } = deleting;
            deleted(id, deleting.at);
            update((s) => {
              s.items = s.items.filter((a) => a.id !== id);
            });
          }}
        />
      )}
    </>
  );
}
