import { STUDIO_MAX_GROUPS } from "@/common/schemas";
import { Btn, Field } from "@/components";
import { useT } from "@/ui/i18n";
import { Fragment, ReactNode } from "react";
import { FiTrash2 } from "react-icons/fi";
import {
  LuAlignHorizontalSpaceBetween,
  LuAlignVerticalSpaceBetween,
  LuGroup,
} from "react-icons/lu";
import { ALIGNS_TO } from "./BoxFields";
import { AlignTo } from "./helper";
import styles from "./studioeditor.module.css";

type Props = {
  // How many groups and elements are selected, 2 or more
  count: number;
  // Why they can't go in a new group: a group among them, as groups don't
  // nest, or the overlay's groups at their cap
  noGroup: "nested" | "full" | null;
  onAlign: (to: AlignTo) => void;
  onSpace: (axis: "x" | "y") => void;
  onGroup: () => void;
  onDelete: () => void;
};

/**
 * Several groups and elements selected: how many, and what they do
 * together. They line up with each other or space out evenly, go in a new
 * group, or go.
 */
export function MultiSettings({
  count,
  noGroup,
  onAlign,
  onSpace,
  onGroup,
  onDelete,
}: Props) {
  const t = useT();
  const button = (
    title: string,
    icon: ReactNode,
    onClick: () => void,
    disabled = false,
  ) => (
    <Btn
      variant="icon"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
    </Btn>
  );
  // Spacing needs one between the two that stay
  const few = count < 3;
  const space = (title: string) => (few ? t("studio.multi.fewToSpace") : title);
  const group =
    noGroup === "nested"
      ? t("studio.multi.groupGroups")
      : noGroup === "full"
        ? t("studio.editor.full", { max: String(STUDIO_MAX_GROUPS) })
        : t("studio.multi.group");

  return (
    <>
      {/* Its actions on the title's row, as the Elements panel has them */}
      <div className={styles.panel_header}>
        <h3 className={styles.panel_title}>
          {t("studio.multi.title", { count })}
        </h3>
        <div className={styles.panel_actions}>
          {button(group, <LuGroup size={18} />, onGroup, noGroup !== null)}
          {button(t("studio.multi.delete"), <FiTrash2 size={18} />, onDelete)}
        </div>
      </div>
      <div className={styles.settings}>
        <Field label={t("studio.multi.align")}>
          <div className={styles.icon_groups}>
            {ALIGNS_TO.map((row) => (
              <div key={row[0].to} className={styles.icon_buttons}>
                {row.map(({ to, label, Icon }) => (
                  <Fragment key={to}>
                    {button(t(label), <Icon size={16} />, () => onAlign(to))}
                  </Fragment>
                ))}
              </div>
            ))}
          </div>
        </Field>
        <Field label={t("studio.multi.space")}>
          <div className={styles.icon_buttons}>
            {button(
              space(t("studio.multi.across")),
              <LuAlignHorizontalSpaceBetween size={16} />,
              () => onSpace("x"),
              few,
            )}
            {button(
              space(t("studio.multi.down")),
              <LuAlignVerticalSpaceBetween size={16} />,
              () => onSpace("y"),
              few,
            )}
          </div>
        </Field>
      </div>
    </>
  );
}
