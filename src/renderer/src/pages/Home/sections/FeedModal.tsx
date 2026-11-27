import { ActivityFeed } from "@/common/schemas";
import { Platform } from "@/common/types";
import { PLATFORM_LABELS } from "@/common/util";
import { Modal, Tabs, tabPanel, Toggle } from "@/components";
import { PLATFORM_ICONS } from "@/helper";
import { useT } from "@/ui/i18n";
import { useId, useState } from "react";
import styles from "../home.module.css";
import { feedKinds } from "../helper";

interface Props {
  feed: ActivityFeed;
  // The profile's, in Home's order: each offers the kinds it sends
  platforms: readonly Platform[];
  onClose: () => void;
  onSave: (feed: ActivityFeed) => void;
}

// With two or more platforms, a tab for each with its own kinds (the user's
// call), so one platform's chats can go and another's stay
export function FeedModal({ feed, platforms, onClose, onSave }: Props) {
  const t = useT();
  const [shown, setShown] = useState(feed);
  const [picked, setPicked] = useState<Platform | null>(null);
  // The one picked, else the first
  const platform =
    picked && platforms.includes(picked) ? picked : (platforms[0] ?? "tiktok");
  const several = platforms.length > 1;
  const panelId = useId();

  return (
    <Modal
      title={t("home.feed.title")}
      description={t("home.feed.description")}
      confirmText={t("common.save")}
      // Room for four tabs, and its header stays put as they change
      maxWidth={several ? "480px" : undefined}
      top={several}
      onClose={onClose}
      onConfirm={() => onSave(shown)}
    >
      {several && (
        <Tabs
          label={t("home.dashboard.platforms")}
          tabs={platforms.map((value) => {
            const Icon = PLATFORM_ICONS[value];
            return {
              value,
              label: PLATFORM_LABELS[value],
              icon: <Icon aria-hidden />,
            };
          })}
          value={platform}
          onChange={setPicked}
          panelId={panelId}
        />
      )}
      <div
        className={styles.feed_kinds}
        {...(several && tabPanel(panelId, platform))}
      >
        {feedKinds([platform]).map(({ kind, label }) => (
          <Toggle
            key={`${platform}:${kind}`}
            label={t(label)}
            checked={shown[platform][kind]}
            onChange={(e) =>
              setShown({
                ...shown,
                [platform]: { ...shown[platform], [kind]: e.target.checked },
              })
            }
          />
        ))}
      </div>
    </Modal>
  );
}
