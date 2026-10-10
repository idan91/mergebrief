import type { ErrorComponentProps } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { briefErrorDetail } from "../../../model/utils/briefErrors";
import styles from "./BriefError.module.scss";

/** The screen a brief route shows when its read failed; the copy is curated, never the raw message. */
export function BriefError({ error }: ErrorComponentProps) {
  const { t } = useTranslation();
  return (
    <main className="main" id="main-content" tabIndex={-1}>
      <section className={styles["errorState"]}>
        <h1>{t("shell.briefFailed")}</h1>
        <p>{briefErrorDetail(t, error)}</p>
      </section>
    </main>
  );
}
