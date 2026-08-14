import { useTranslation } from "react-i18next";
import { Button } from "@web/components/Button/Button";
import styles from "./PrBriefError.module.scss";
import { prBriefErrorDetail, prBriefErrorNeedsSignIn } from "./utils";

export interface PrBriefErrorProps {
  error: Error;
}

export function PrBriefError({ error }: PrBriefErrorProps) {
  const { t } = useTranslation();
  return (
    <main className="main" id="main-content" tabIndex={-1}>
      <section className={styles["errorState"]} data-testid="pr-brief-error">
        <h1>{t("pulls.errorBoundary.heading")}</h1>
        {/* Curated copy only — never `error.message`: an SSR loader or
            server-function rejection serializes its own text, and even
            ApiError's message embeds the request path. */}
        <p>{prBriefErrorDetail(t, error)}</p>
        {prBriefErrorNeedsSignIn(error) ? (
          <Button as="a" href="/api/auth/github" variant="primary">
            {t("pulls.errorBoundary.signIn")}
          </Button>
        ) : null}
      </section>
    </main>
  );
}
