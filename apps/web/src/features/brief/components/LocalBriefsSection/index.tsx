// The DEV file surface's list: the artifacts in MERGEBRIEF_OUT_DIR. Renders
// nothing without a session (the readers refuse; `enabled` keeps the query
// idle), when no directory is named (the listing is empty) or when it is
// empty. Callers gate on `import.meta.env.PROD`, a build-time constant, so
// this leaves a production bundle entirely.
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { buildLocalBriefsQueryOptions } from "../../queries";
import { LocalBriefRow } from "./LocalBriefRow";
import styles from "./LocalBriefsSection.module.scss";

export interface LocalBriefsSectionProps {
  enabled: boolean;
}

export function LocalBriefsSection({ enabled }: LocalBriefsSectionProps) {
  const { t } = useTranslation();
  const { data: briefs } = useQuery({
    ...buildLocalBriefsQueryOptions(),
    enabled,
  });

  if (briefs === undefined || briefs.length === 0) {
    return null;
  }

  return (
    <section
      aria-labelledby="local-briefs-heading"
      className={styles["section"]}
    >
      <h2 className={styles["heading"]} id="local-briefs-heading">
        {t("shell.localBriefs")}
      </h2>
      <ol className={styles["list"]}>
        {briefs.map((brief) => (
          <LocalBriefRow brief={brief} key={brief.id} />
        ))}
      </ol>
    </section>
  );
}
