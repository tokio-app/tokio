import { EntityMetadata } from "@/common/schemas";
import { cx } from "@/helper/cx";
import { useMenu } from "@/hooks/useMenu";
import { FiCheck, FiChevronDown } from "react-icons/fi";
import styles from "./profiledropdown.module.css";

type Props = {
  onProfileSelected: (file: string) => void;
  active: EntityMetadata;
  profiles: EntityMetadata[];
  disabled: boolean;
};

export function ProfileDropdown({
  profiles,
  onProfileSelected,
  active,
  disabled,
}: Props) {
  const { open, ref, toggleRef, toggle, close, onKeyDown } = useMenu();

  return (
    <div className={styles.container} ref={ref} onKeyDown={onKeyDown}>
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={open}
        disabled={disabled}
        onClick={toggle}
        className={cx(
          styles.toggle,
          open && styles.toggle_open,
          disabled && styles.toggle_disabled,
        )}
      >
        <span className={styles.avatar} aria-hidden>
          🌹
        </span>
        <span>{active.name}</span>
        <FiChevronDown
          size={14}
          className={cx(styles.chevron, open && styles.chevron_open)}
        />
      </button>

      {open && (
        <div className={styles.menu}>
          {profiles.map((profile) => {
            const isActive = profile.file === active.file;
            return (
              <button
                key={profile.file}
                type="button"
                aria-current={isActive || undefined}
                className={cx(styles.item, isActive && styles.item_active)}
                onClick={() => {
                  close();
                  if (!isActive) onProfileSelected(profile.file);
                }}
              >
                {profile.name}
                {isActive && (
                  <FiCheck size={14} color="var(--accent-primary)" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
