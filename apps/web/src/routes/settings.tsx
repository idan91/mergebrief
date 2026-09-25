// Settings page. Session-gated like the Inbox: a viewer who is not signed
// in gets the sign-in pointer, never a broken form.
import { Trans, useTranslation } from "react-i18next";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  useRouter,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import { FailureBlock } from "@web/components/FailureBlock";
import { TokenSettings } from "@web/features/tokens";
import { buildViewerQueryOptions } from "../features/account/queries";
import { ViewerStates } from "../features/account/types";
import { appI18n } from "../i18n/I18nProvider";
import { buildPageTitle } from "@web/utils/pageTitle";
import styles from "./settings.module.scss";

export const Route = createFileRoute("/settings")({
  // The server render fails fast; the client's own refetch keeps the retries.
  loader: ({ context }) =>
    context.queryClient.ensureQueryData({
      ...buildViewerQueryOptions(),
      retry: false,
    }),
  head: () => {
    const pageName = appI18n.t("shell.pageTitle.settings");

    return { meta: [{ title: buildPageTitle(appI18n.t, [pageName]) }] };
  },
  component: SettingsPage,
  errorComponent: SettingsUnavailable,
});

interface SettingsShellProps {
  children: ReactNode;
}

/** One shell for every state, so the landmark, the breadcrumb and the heading survive a failed read. */
function SettingsShell({ children }: SettingsShellProps) {
  const { t } = useTranslation();
  return (
    <main className={styles["main"]} id="main-content" tabIndex={-1}>
      <nav
        aria-label={t("shell.ariaLabelBreadcrumb")}
        className={styles["breadcrumb"]}
      >
        <Link to="/">{t("shell.backToBriefs")}</Link>
      </nav>
      <h1>{t("shell.settingsHeading")}</h1>
      {children}
    </main>
  );
}

/** A backend failure is not proof the viewer is signed out; the read can be asked again. */
function SettingsUnavailable({ reset }: ErrorComponentProps) {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <SettingsShell>
      <FailureBlock
        detail={t("shell.serverUnavailable")}
        heading={<h2>{t("shell.settingsUnavailable")}</h2>}
        retryLabel={t("home.failed.retry")}
        onRetry={() => {
          reset();
          void router.invalidate();
        }}
      />
    </SettingsShell>
  );
}

function SettingsPage() {
  const { t } = useTranslation();
  const viewer = useSuspenseQuery(buildViewerQueryOptions()).data;
  const signInPrompt = (
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
  );
  // Only a viewer the API confirmed reaches the form; a read that did not
  // answer lands on the sign-in side.
  const contentByKind: Record<typeof viewer.kind, ReactNode> = {
    [ViewerStates.SIGNED_IN]: <TokenSettings enabled />,
    [ViewerStates.UNKNOWN]: signInPrompt,
    [ViewerStates.SIGNED_OUT]: signInPrompt,
  };

  return <SettingsShell>{contentByKind[viewer.kind]}</SettingsShell>;
}
