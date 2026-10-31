import { useTranslation } from "react-i18next";
import { Markdown } from "@web/components/Markdown";
import type { Brief } from "../../../../model/types";
import styles from "./DeltaContext.module.scss";
import { PackageSourceFiles } from "./PackageSourceFiles";

export interface DeltaContextProps {
  brief: Brief;
}

export function DeltaContext({ brief }: DeltaContextProps) {
  const { t } = useTranslation();
  return (
    <div className={styles["context"]}>
      {brief.commentsAddressed ? (
        <section>
          <div className={styles["eyebrow"]}>
            {t("brief.delta.commentsAddressed")}
          </div>
          <Markdown content={brief.commentsAddressed} />
        </section>
      ) : null}
      {brief.wholePrImpact ? (
        <section>
          <div className={styles["eyebrow"]}>
            {t("brief.delta.wholePrImpact")}
          </div>
          <p>{brief.wholePrImpact}</p>
        </section>
      ) : null}
      {brief.packageSourceFiles?.length ? (
        <PackageSourceFiles files={brief.packageSourceFiles} />
      ) : null}
    </div>
  );
}
