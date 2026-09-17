// The DEV file surface's list: the artifacts in MERGEBRIEF_OUT_DIR, as the
// picker showed them before the DB list replaced it. Renders nothing when the
// directory is unset (the query refuses) or empty. Callers gate on
// `import.meta.env.PROD`, a build-time constant, so this leaves a production
// bundle entirely.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { buildLocalBriefsQueryOptions } from "../../queries";
import styles from "../../../../routes/index.module.scss";

export function LocalBriefsSection() {
  const { t } = useTranslation();
  const { data: briefs } = useQuery(buildLocalBriefsQueryOptions());

  if (briefs === undefined || briefs.length === 0) {
    return null;
  }

  return (
    <>
      <h2 className={styles["listLabel"]}>{t("shell.localBriefs")}</h2>
      <ul className={styles["list"]}>
        {briefs.map((brief) => (
          <li key={brief.id}>
            <Link
              className={styles["link"]}
              params={{ briefId: brief.id }}
              to="/briefs/$briefId"
            >
              <span className={styles["linkTitle"]}>
                <span
                  className={styles["artifactPill"]}
                  data-kind={brief.artifactKind}
                >
                  {brief.artifactKind === "delta"
                    ? t("shell.artifactDelta")
                    : t("shell.artifactBrief")}
                </span>
                {brief.title}
              </span>
              <span className={styles["meta"]}>
                {brief.repo} #{brief.number} · {brief.id} ·{" "}
                {brief.artifactKind === "delta" &&
                brief.baselineSha &&
                brief.headSha
                  ? `${brief.baselineSha.slice(0, 7)} → ${brief.headSha.slice(0, 7)}`
                  : brief.sha.slice(0, 7)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
