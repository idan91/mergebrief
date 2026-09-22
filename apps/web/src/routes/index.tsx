import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { InboxSorts } from "types/inbox";

import { Button } from "@web/components/Button/Button";
import { Header } from "@web/components/Header/Header";
import { AccountMenu } from "@web/features/account";
import { buildViewerQueryOptions } from "../features/account/queries";
import { LocalBriefsSection } from "@web/features/brief";
import { buildLocalBriefsQueryOptions } from "../features/brief/queries";
import { briefErrorDetail } from "@web/features/brief/utils";
import { InboxList, PersonalLine, UrlBox } from "@web/features/inbox";
import { buildInboxQueryOptions } from "../features/inbox/queries";
import { InboxStates } from "../features/inbox/types";
import { appI18n } from "../i18n/I18nProvider";
import { buildPageTitle } from "@web/utils/pageTitle";
import styles from "./index.module.scss";
import sharedStyles from "./routeShared.module.scss";

const SIGN_IN_PATH = "/api/auth/github";
const INBOX_PARAMS = {};

export const Route = createFileRoute("/")({
  // The Inbox and the viewer prefetch in parallel through the in-process
  // apiFetch interface, the same authz gate the browser meets.
  loader: async ({ context }) => {
    // The server render fails fast; the client's own refetch keeps the retries.
    const prefetches: Promise<unknown>[] = [
      context.queryClient.ensureQueryData({
        ...buildInboxQueryOptions(INBOX_PARAMS),
        retry: false,
      }),
      context.queryClient
        .ensureQueryData({ ...buildViewerQueryOptions(), retry: false })
        .catch(() => undefined),
    ];
    // The DEV file surface, prefetched only behind a session (the readers
    // refuse without one) and never allowed to fail the page. The `if` is a
    // build-time constant, so production keeps the two above.
    if (!import.meta.env.PROD) {
      prefetches.push(
        context.queryClient
          .ensureQueryData(buildInboxQueryOptions(INBOX_PARAMS))
          .then((inbox) =>
            inbox.kind === InboxStates.READY
              ? context.queryClient.ensureQueryData(
                  buildLocalBriefsQueryOptions(),
                )
              : undefined,
          )
          .catch(() => undefined),
      );
    }
    await Promise.all(prefetches);
  },
  head: () => {
    const pageName = appI18n.t("shell.pageTitle.home");

    return { meta: [{ title: buildPageTitle(appI18n.t, [pageName]) }] };
  },
  component: Home,
  errorComponent: HomeError,
});

function Home() {
  const inbox = useSuspenseQuery(buildInboxQueryOptions(INBOX_PARAMS)).data;

  if (inbox.kind === InboxStates.SIGNED_OUT) return <SignedOutHome />;

  return (
    <>
      <Header end={<AccountMenu />} />
      <main className={styles["home"]} id="main-content" tabIndex={-1}>
        <div className={styles["lead"]}>
          <PersonalLine counts={inbox.page.counts} />
          <UrlBox />
        </div>
        <InboxList items={inbox.page.items} sort={InboxSorts.UPDATED} />
        {import.meta.env.PROD ? null : <LocalBriefsSection enabled />}
      </main>
    </>
  );
}

/** The pitch a visitor sees before signing in; the ticket's own copy replaces it later. */
function SignedOutHome() {
  const { t } = useTranslation();

  return (
    <>
      <Header end={<AccountMenu />} />
      <main className={styles["pickerMain"]} id="main-content" tabIndex={-1}>
        <section className={styles["picker"]}>
          <div className={styles["eyebrow"]}>{t("shell.landingEyebrow")}</div>
          <h1>{t("shell.landingHeading")}</h1>
          <p className={styles["copy"]}>{t("shell.landingCopy")}</p>
          <ul className={styles["pillars"]}>
            <li>{t("shell.landingBullet1")}</li>
            <li>{t("shell.landingBullet2")}</li>
            <li>{t("shell.landingBullet3")}</li>
          </ul>
          <Button as="a" href={SIGN_IN_PATH} variant="primary">
            {t("shell.signInWithGithub")}
          </Button>
        </section>
      </main>
    </>
  );
}

function HomeError({ error }: { error: Error }) {
  const { t } = useTranslation();
  return (
    <main className="main" id="main-content" tabIndex={-1}>
      <section className={sharedStyles["errorState"]}>
        <h1>{t("shell.briefListFailed")}</h1>
        {/* Curated copy only: a raw server message would leak internals. */}
        <p>{briefErrorDetail(t, error)}</p>
      </section>
    </main>
  );
}
