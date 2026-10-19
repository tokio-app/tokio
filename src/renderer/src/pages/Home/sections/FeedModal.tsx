import { ActivityFeed } from "@/common/schemas";
import { Modal, Toggle } from "@/components";
import { useState } from "react";
import { FEED_KINDS } from "../helper";

interface Props {
  feed: ActivityFeed;
  onClose: () => void;
  onSave: (feed: ActivityFeed) => void;
}

export function FeedModal({ feed, onClose, onSave }: Props) {
  const [shown, setShown] = useState(feed);

  return (
    <Modal
      title="Activity Feed"
      description="Pick what the feed shows. New followers, shares, gifts and coins are counted either way."
      confirmText="Save"
      onClose={onClose}
      onConfirm={() => onSave(shown)}
    >
      {FEED_KINDS.map(({ kind, label }) => (
        <Toggle
          key={kind}
          label={label}
          checked={shown[kind]}
          onChange={(e) => setShown({ ...shown, [kind]: e.target.checked })}
        />
      ))}
    </Modal>
  );
}
