import { cx } from "@/helper/cx";
import { useT } from "@/ui/i18n";
import { useRef, useState } from "react";
import { MdOutlineSearch, MdOutlineSearchOff } from "react-icons/md";
import { Btn } from "./Btn";
import styles from "./elements.module.css";
import { Input } from "./Input";

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
};

/**
 * A search button that opens a search field beside it, for a header's
 * actions. Closing it clears the search.
 */
export function SearchToggle({ value, onChange, placeholder }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  return (
    <>
      <Input
        ref={ref}
        className={cx(styles.search, open && styles.search_open)}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // Only CSS hides it, so keep it out of the keyboard's reach too
        tabIndex={open ? undefined : -1}
        aria-hidden={!open || undefined}
      />
      <Btn
        title={open ? t("components.searchToggle.close") : t("common.search")}
        onClick={() => {
          if (open) onChange("");
          else ref.current?.focus();
          setOpen(!open);
        }}
      >
        {open ? (
          <MdOutlineSearchOff size={24} />
        ) : (
          <MdOutlineSearch size={24} />
        )}
      </Btn>
    </>
  );
}
