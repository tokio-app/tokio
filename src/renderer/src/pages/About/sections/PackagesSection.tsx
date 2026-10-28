import { PackageLicense } from "@/common/types";
import { Btn, EmptyState, Input, Section, Spinner } from "@/components";
import { cx } from "@/helper/cx";
import { useT } from "@/ui/i18n";
import { useMemo, useState } from "react";
import { FiBox, FiExternalLink, FiFileText } from "react-icons/fi";
import styles from "../about.module.css";

type Props = {
  packages?: PackageLicense[];
  failed: boolean;
  onView: (id: string) => void;
};

export function PackagesSection({ packages, failed, onView }: Props) {
  const t = useT();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!packages || !q) return packages ?? [];
    return packages.filter(
      (pkg) =>
        pkg.name.toLowerCase().includes(q) ||
        pkg.license.toLowerCase().includes(q),
    );
  }, [packages, query]);

  return (
    <Section
      icon={<FiBox />}
      title={t("about.packages.title")}
      description={
        packages
          ? t("about.packages.count", { count: packages.length })
          : t("about.packages.description")
      }
    >
      {failed ? (
        <EmptyState>{t("about.packages.failed")}</EmptyState>
      ) : !packages ? (
        <div className={styles.loading}>
          <Spinner size={24} />
        </div>
      ) : (
        <>
          <Input
            placeholder={t("about.packages.search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {filtered.length === 0 ? (
            <EmptyState>
              {t("about.packages.noMatch", { query: query.trim() })}
            </EmptyState>
          ) : (
            <div className={cx(styles.list, styles.list_scroll)}>
              {filtered.map((pkg) => (
                <div key={pkg.id} className={styles.row}>
                  <div className={styles.row_info}>
                    <div className={styles.row_title}>
                      <span className={styles.row_name}>{pkg.name}</span>
                      <span className={styles.muted}>{pkg.version}</span>
                      <span
                        className={cx(
                          styles.badge,
                          pkg.copyleft && styles.badge_copyleft,
                        )}
                      >
                        {pkg.license}
                      </span>
                    </div>
                    {pkg.author && <p className={styles.muted}>{pkg.author}</p>}
                  </div>
                  {pkg.url && (
                    <a
                      className={styles.link}
                      href={pkg.url}
                      target="_blank"
                      rel="noreferrer"
                      title={t("about.packages.repository")}
                    >
                      <FiExternalLink size={18} />
                    </a>
                  )}
                  <Btn
                    variant="icon"
                    title={t("about.viewLicense")}
                    onClick={() => onView(pkg.id)}
                  >
                    <FiFileText size={18} />
                  </Btn>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Section>
  );
}
