import { useTranslation } from "react-i18next";
import { Button } from "@web/components/Button";
import { isSignedOutError } from "@web/data/apiFetch";
import { EmptyBlock } from "@web/components/EmptyBlock";
import { SignInPage } from "@web/components/SignInPage";
import { SIGN_IN_PATH } from "@web/data/sign-in";
import { prBriefErrorDetail } from "@web/features/brief/model";
import { prBriefErrorNeedsSignIn } from "./utils";

export interface PrBriefErrorProps {
  error: unknown;
  /** The page the viewer is on, so a sign-in lands back on it. */
  returnTo?: string | undefined;
}

export function PrBriefError({ error, returnTo }: PrBriefErrorProps) {
  const { t } = useTranslation();
  if (isSignedOutError(error)) {
    return (
      <SignInPage
        heading={t("pulls.signIn.heading")}
        lead={t("pulls.signIn.detail")}
        returnTo={returnTo}
      />
    );
  }

  // Curated copy only, never `error.message`: an SSR loader or
  // server-function rejection serializes its own text, and even ApiError's
  // message embeds the request path.
  const detail = prBriefErrorDetail(t, error);
  const action = prBriefErrorNeedsSignIn(error) ? (
    <Button as="a" href={SIGN_IN_PATH} variant="primary">
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
