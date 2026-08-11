// Settings page. Session-gated like the picker's DB sections — logged-out
// viewers get the sign-in pointer, never a broken form.
import { useTranslation } from "react-i18next";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { TokenSettings } from "@web/features/tokens";
import { pullsSessionQueryOptions } from "../features/pulls/queries";
import styles from "./settings.module.scss";

export const Route = createFileRoute("/settings")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(pullsSessionQueryOptions()),
  component: SettingsPage,
});

function SettingsPage() {
  const { t } = useTranslation();
  const session = useSuspenseQuery(pullsSessionQueryOptions()).data;

  return (
    <main className={styles["main"]} id="main-content" tabIndex={-1}>
      <nav
        aria-label={t("shell.ariaLabelBreadcrumb")}
        className={styles["breadcrumb"]}
      >
        <Link to="/">{t("shell.backToBriefs")}</Link>
      </nav>
      <h1>{t("shell.settingsHeading")}</h1>
      {session.kind === "ready" ? (
        <TokenSettings enabled />
      ) : session.kind === "unavailable" ? (
        // A backend/GitHub failure is NOT proof the viewer is logged out, so
        // the copy stays recoverable rather than telling them to sign in.
        <p className={styles["signedOut"]} role="alert">
          {t("shell.serverUnavailable")}
        </p>
      ) : (
        <p className={styles["signedOut"]}>
          <a href="/api/auth/github">{t("shell.signInWithGithub")}</a>{" "}
          {t("shell.toManageTokens")}
        </p>
      )}
    </main>
  );
}
