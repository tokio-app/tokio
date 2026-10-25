import { Profile } from "@/common/schemas";
import { Btn, NumberInput, SearchToggle, Section, Toggle } from "@/components";
import { Updater } from "@/hooks";
import { Ref } from "react";
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
  return (
    <Section
      title="Alerts"
      description="Enhance your stream with custom alerts."
      actions={
        <>
          <SearchToggle
            placeholder="Search alerts..."
            value={search}
            onChange={onSearch}
          />
          <Btn ref={addRef} title="Add alert" onClick={onAdd}>
            <MdOutlineAddAlert size={20} />
          </Btn>
        </>
      }
    >
      <div className={styles.settings}>
        <Toggle
          label="Play alerts simultaneously"
          checked={simultaneous}
          onChange={(e) =>
            update((s) => {
              s.simultaneous = e.target.checked;
            })
          }
        />
        <label className={styles.queue_length}>
          Max queue length
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
