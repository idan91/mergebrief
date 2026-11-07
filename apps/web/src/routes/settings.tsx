// Settings page. Session-gated like the Inbox: a viewer who is not signed
// in gets the sign-in pointer, never a broken form.
import { useTranslation } from "react-i18next";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  useRouter,
  useRouterState,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import { FailureBlock } from "@web/components/FailureBlock";
import { Icon } from "@web/components/Icon";
import {
  IconNames,
  IconRotations,
  IconSizes,
} from "@web/components/Icon/types";
import {
  deriveEnabledTabs,
  parseSettingsSearch,
  resolveActiveTab,
  SETTINGS_TABS,
  SettingsTabs,
  type SettingsTabId,
} from "@web/features/settings";
import { buildViewerQueryOptions } from "../features/account/queries";
import { ViewerStates } from "../features/account/types";
import { appI18n } from "../i18n/I18nProvider";
import { SignInPage } from "@web/components/SignInPage";
import { buildPageTitle } from "@web/utils/pageTitle";
import styles from "./settings.module.scss";

export const Route = createFileRoute("/settings")({
  validateSearch: parseSettingsSearch,
  // The server render fails fast; the client's own refetch keeps the retries.
  loader: ({ context }) =>
    context.queryClient.ensureQueryData({
      ...buildViewerQueryOptions(),
      retry: false,
    }),
  head: ({ loaderData }) => {
    const asksForSignIn =
      loaderData !== undefined && loaderData.kind !== ViewerStates.SIGNED_IN;
    const pageName = asksForSignIn
      ? appI18n.t("shell.signIn.settingsHeading")
      : appI18n.t("shell.pageTitle.settings");

    return { meta: [{ title: buildPageTitle(appI18n.t, [pageName]) }] };
  },
  component: SettingsPage,
  errorComponent: SettingsUnavailable,
});

export interface SettingsShellProps {
  children: ReactNode;
  /** The rail needs a wider column than a lone panel. */
  wide?: boolean;
}

/** One shell for every state, so the landmark, the breadcrumb and the heading survive a failed read. */
function SettingsShell({ children, wide = false }: SettingsShellProps) {
  const width = wide ? "wide" : "narrow";
  const { t } = useTranslation();
  return (
    <main
      className={styles["main"]}
      data-width={width}
      id="main-content"
      tabIndex={-1}
    >
      <nav
        aria-label={t("shell.ariaLabelBreadcrumb")}
        className={styles["breadcrumb"]}
      >
        <Link to="/">
          <Icon
            name={IconNames.ARROW_UP}
            rotation={IconRotations.THREE_QUARTERS}
            size={IconSizes.MD}
          />
          {t("shell.backToBriefs")}
        </Link>
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
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const returnTo = useRouterState({ select: (state) => state.location.href });

  if (viewer.kind !== ViewerStates.SIGNED_IN) {
    // Only a viewer the API confirmed reaches the tabs; a read that did not
    // answer lands on the sign-in side.
    return (
      <SignInPage
        heading={t("shell.signIn.settingsHeading")}
        returnTo={returnTo}
      />
    );
  }

  const tabs = deriveEnabledTabs(SETTINGS_TABS, viewer.operator);
  const active = resolveActiveTab(tabs, search.tab);

  const wide = tabs.length > 1;

  function selectTab(tab: SettingsTabId) {
    void navigate({ search: { tab }, hash: true, replace: true });
  }

  return (
    <SettingsShell wide={wide}>
      <SettingsTabs active={active} onSelect={selectTab} tabs={tabs} />
    </SettingsShell>
  );
}
