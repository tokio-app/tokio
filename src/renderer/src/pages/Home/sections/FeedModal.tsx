import { ActivityFeed } from "@/common/schemas";
import { Platform } from "@/common/types";
import { Modal, Toggle } from "@/components";
import { useT } from "@/ui/i18n";
import { useState } from "react";
import { feedKinds } from "../helper";

interface Props {
  feed: ActivityFeed;
  // The profile's: the feed offers the kinds they send
  platforms: readonly Platform[];
  onClose: () => void;
  onSave: (feed: ActivityFeed) => void;
}

export function FeedModal({ feed, platforms, onClose, onSave }: Props) {
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
      {feedKinds(platforms).map(({ kind, label }) => (
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
