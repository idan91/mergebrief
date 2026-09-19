// Settings page. Session-gated like the picker's DB sections, logged-out
// viewers get the sign-in pointer, never a broken form.
import { Trans, useTranslation } from "react-i18next";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { TokenSettings } from "@web/features/tokens";
import { buildPullsSessionQueryOptions } from "../features/pulls/queries";
import type { PullsSession } from "../features/pulls/types";
import { appI18n } from "../i18n/I18nProvider";
import { buildPageTitle } from "@web/utils/pageTitle";
import styles from "./settings.module.scss";

export const Route = createFileRoute("/settings")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(buildPullsSessionQueryOptions()),
  head: () => {
    const pageName = appI18n.t("shell.pageTitle.settings");

    return { meta: [{ title: buildPageTitle(appI18n.t, [pageName]) }] };
  },
  component: SettingsPage,
});

function SettingsPage() {
  const { t } = useTranslation();
  const session = useSuspenseQuery(buildPullsSessionQueryOptions()).data;

  // A backend/GitHub failure is NOT proof the viewer is logged out, so
  // the copy stays recoverable rather than telling them to sign in.
  const contentByKind: Record<PullsSession["kind"], ReactNode> = {
    ready: <TokenSettings enabled />,
    unavailable: (
      <p className={styles["signedOut"]} role="alert">
        {t("shell.serverUnavailable")}
      </p>
    ),
    "logged-out": (
      <p className={styles["signedOut"]}>
        <Trans
          components={[
            <a href="/api/auth/github" key="signIn">
              {t("shell.signInWithGithub")}
            </a>,
          ]}
          i18nKey="shell.signInPrompt"
        />
      </p>
    ),
  };

  return (
    <main className={styles["main"]} id="main-content" tabIndex={-1}>
      <nav
        aria-label={t("shell.ariaLabelBreadcrumb")}
        className={styles["breadcrumb"]}
      >
        <Link to="/">{t("shell.backToBriefs")}</Link>
      </nav>
      <h1>{t("shell.settingsHeading")}</h1>
      {contentByKind[session.kind]}
    </main>
  );
}
