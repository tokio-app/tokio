import { useMenu } from "@/hooks";
import { ReactNode, Ref } from "react";
import { FiPlus } from "react-icons/fi";
import { Btn } from "../Elements";

interface Props {
  // What the button and its menu are named
  label: string;
  menu: ReturnType<typeof useMenu>;
  // The page's own classes for the anchor and the menu under the button
  className: string;
  menuClassName: string;
  menuRef?: Ref<HTMLDivElement>;
  // The menu's items, while it's open
  children: ReactNode;
}

/** A `+` icon button that opens a menu under it, on a section's title row. */
export function AddMenuButton({
  label,
  menu,
  className,
  menuClassName,
  menuRef,
  children,
}: Props) {
  return (
    <div className={className} ref={menu.ref} onKeyDown={menu.onKeyDown}>
      <Btn
        ref={menu.toggleRef}
        variant="icon"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        onClick={menu.toggle}
      >
        <FiPlus size={20} />
      </Btn>
      {menu.open && (
        <div
          ref={menuRef}
          className={menuClassName}
          role="menu"
          aria-label={label}
        >
          {children}
        </div>
      )}
    </div>
  );
}
