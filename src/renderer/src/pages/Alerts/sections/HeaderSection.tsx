import { Profile } from "@/common/schemas";
import { Btn, NumberInput, SearchToggle, Section, Toggle } from "@/components";
import { Updater } from "@/hooks";
import { useT } from "@/ui/i18n";
import { useNavigate } from "@tanstack/react-router";
import { Ref } from "react";
import { LuLibrary } from "react-icons/lu";
import { MdOutlineAddAlert } from "react-icons/md";
import styles from "../alerts.module.css";

type Props = {
  simultaneous: boolean;
  queueLength: number;
  // The page shows another add button under the alerts while this one is
  // scrolled out of view
  addRef: Ref<HTMLButtonElement>;
  // Finds alerts by name
  search: string;
  onSearch: (search: string) => void;
  onAdd: () => void;
  update: Updater<Profile["alerts"]>;
};

export function HeaderSection({
  simultaneous,
  queueLength,
  addRef,
  search,
  onSearch,
  onAdd,
  update,
}: Props) {
  const t = useT();
  const navigate = useNavigate();
  return (
    <Section
      title={t("alerts.header.title")}
      description={t("alerts.header.description")}
      actions={
        <>
          <SearchToggle
            placeholder={t("alerts.header.searchPlaceholder")}
            value={search}
            onChange={onSearch}
          />
          <Btn onClick={() => navigate({ to: "/alerts/library" })}>
            <LuLibrary size={18} />
            {t("alerts.library.title")}
          </Btn>
          <Btn ref={addRef} title={t("alerts.header.add")} onClick={onAdd}>
            <MdOutlineAddAlert size={20} />
          </Btn>
        </>
      }
    >
      <div className={styles.settings}>
        <Toggle
          label={t("alerts.header.simultaneous")}
          checked={simultaneous}
          onChange={(e) =>
            update((s) => {
              s.simultaneous = e.target.checked;
            })
          }
        />
        <label className={styles.queue_length}>
          {t("common.maxQueueLength")}
          <NumberInput
            min={1}
            integer
            className={styles.number_input}
            value={queueLength}
            onChange={(length) =>
              update((s) => {
                s.queue_length = length;
              })
            }
          />
        </label>
      </div>
    </Section>
  );
}
