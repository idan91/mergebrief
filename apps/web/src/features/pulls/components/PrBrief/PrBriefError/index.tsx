import { useTranslation } from "react-i18next";
import { Button } from "@web/components/Button";
import { EmptyBlock } from "@web/components/EmptyBlock";
import { prBriefErrorDetail, prBriefErrorNeedsSignIn } from "./utils";

export interface PrBriefErrorProps {
  error: Error;
}

export function PrBriefError({ error }: PrBriefErrorProps) {
  const { t } = useTranslation();
  // Curated copy only, never `error.message`: an SSR loader or
  // server-function rejection serializes its own text, and even ApiError's
  // message embeds the request path.
  const detail = prBriefErrorDetail(t, error);
  const action = prBriefErrorNeedsSignIn(error) ? (
    <Button as="a" href="/api/auth/github" variant="accent">
      {t("pulls.errorBoundary.signIn")}
    </Button>
  ) : undefined;

  return (
    <main className="main" id="main-content" tabIndex={-1}>
      <section
        aria-labelledby="pr-brief-error-heading"
        data-testid="pr-brief-error"
      >
        <EmptyBlock
          action={action}
          detail={detail}
          heading={
            <h1 id="pr-brief-error-heading">
              {t("pulls.errorBoundary.heading")}
            </h1>
          }
        />
      </section>
    </main>
  );
}
