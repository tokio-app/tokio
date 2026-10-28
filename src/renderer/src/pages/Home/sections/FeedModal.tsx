import { ActivityFeed } from "@/common/schemas";
import { Modal, Toggle } from "@/components";
import { useT } from "@/ui/i18n";
import { useState } from "react";
import { FEED_KINDS } from "../helper";

interface Props {
  feed: ActivityFeed;
  onClose: () => void;
  onSave: (feed: ActivityFeed) => void;
}

export function FeedModal({ feed, onClose, onSave }: Props) {
  const t = useT();
  const [shown, setShown] = useState(feed);

  return (
    <Modal
      title={t("home.feed.title")}
      description={t("home.feed.description")}
      confirmText={t("common.save")}
      onClose={onClose}
      onConfirm={() => onSave(shown)}
    >
      {FEED_KINDS.map(({ kind, label }) => (
        <Toggle
          key={kind}
          label={t(label)}
          checked={shown[kind]}
          onChange={(e) => setShown({ ...shown, [kind]: e.target.checked })}
        />
      ))}
    </Modal>
  );
}
