import { Profile } from "@/common/schemas";
import { Btn, EmptyState, Input, Section, VoiceSelect } from "@/components";
import { Updater } from "@/hooks";
import { useT } from "@/ui/i18n";
import { FiPlus, FiTrash2 } from "react-icons/fi";
import styles from "../tts.module.css";

type Settings = Profile["tts"];
type UserVoices = Settings["user_voices"];

interface Props {
  userVoices: UserVoices;
  // The page's, which a new user starts with
  voice: Settings["voice"];
  filters: Settings["filters"];
  update: Updater<UserVoices>;
}

export function UserVoicesSection({
  userVoices,
  voice,
  filters,
  update,
}: Props) {
  const t = useT();
  return (
    <Section
      title={t("tts.users.title")}
      description={t("tts.users.description")}
      actions={
        <Btn
          variant="icon"
          title={t("tts.users.add")}
          onClick={() =>
            update((u) => {
              u.push({ handle: "", voice });
            })
          }
        >
          <FiPlus size={20} />
        </Btn>
      }
    >
      <div className={styles.rows}>
        {userVoices.map((user, index) => (
          <div key={index} className={styles.row}>
            <Input
              placeholder={t("tts.users.handle")}
              value={user.handle}
              onChange={(e) =>
                update((u) => {
                  u[index].handle = e.target.value;
                })
              }
            />
            {/* shortcut: each row's VoiceSelect asks main for the voices, share one request if the lists get long */}
            <VoiceSelect
              value={user.voice}
              filters={filters}
              onChange={(picked) =>
                update((u) => {
                  u[index].voice = picked;
                })
              }
            />
            <Btn
              variant="icon"
              title={t("common.remove")}
              onClick={() =>
                update((u) => {
                  u.splice(index, 1);
                })
              }
            >
              <FiTrash2 size={18} />
            </Btn>
          </div>
        ))}

        {userVoices.length === 0 && (
          <EmptyState>{t("tts.users.empty")}</EmptyState>
        )}
      </div>
    </Section>
  );
}
