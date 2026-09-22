import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Button } from "@web/components/Button/Button";
import { Header } from "@web/components/Header/Header";
import { AccountMenu } from "@web/features/account";
import { buildViewerQueryOptions } from "../features/account/queries";
import { LocalBriefsSection } from "@web/features/brief";
import { buildLocalBriefsQueryOptions } from "../features/brief/queries";
import { briefErrorDetail } from "@web/features/brief/utils";
import {
  Controls,
  InboxList,
  Pager,
  PersonalLine,
  UrlBox,
  useControlsFacade,
  useInboxSearchState,
} from "@web/features/inbox";
import { buildInboxQueryOptions } from "../features/inbox/queries";
import {
  countChangedFilters,
  parseInboxSearch,
  readInboxParams,
} from "../features/inbox/search";
import {
  InboxStates,
  type InboxPage,
  type InboxSearch,
} from "../features/inbox/types";
import { appI18n } from "../i18n/I18nProvider";
import { buildPageTitle } from "@web/utils/pageTitle";
import styles from "./index.module.scss";
import sharedStyles from "./routeShared.module.scss";

const SIGN_IN_PATH = "/api/auth/github";

export const Route = createFileRoute("/")({
  // The list's state is the URL: unknown values drop, defaults are omitted.
  validateSearch: (search: Record<string, unknown>): InboxSearch =>
    parseInboxSearch(search),
  loaderDeps: ({ search }) => readInboxParams(search),
  // The Inbox and the viewer prefetch in parallel through the in-process
  // apiFetch interface, the same authz gate the browser meets.
  loader: async ({ context, deps }) => {
    // The server render fails fast; the client's own refetch keeps the retries.
    const prefetches: Promise<unknown>[] = [
      context.queryClient.ensureQueryData({
        ...buildInboxQueryOptions(deps),
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
          .ensureQueryData(buildInboxQueryOptions(deps))
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
  const search = Route.useSearch();
  const inbox = useSuspenseQuery(
    buildInboxQueryOptions(readInboxParams(search)),
  ).data;

  if (inbox.kind === InboxStates.SIGNED_OUT) return <SignedOutHome />;

  return <SignedInHome page={inbox.page} search={search} />;
}

function SignedInHome({
  page,
  search,
}: {
  page: InboxPage;
  search: InboxSearch;
}) {
  const state = useInboxSearchState(search, page.total, page.pageSize);
  const controls = useControlsFacade(page, search, state.choices, state.write);
  const changedCount = countChangedFilters(search);
  const showControls = page.total > 0 || changedCount > 0;

  return (
    <>
      <Header end={<AccountMenu />} />
      <main className={styles["home"]} id="main-content" tabIndex={-1}>
        <div className={styles["lead"]}>
          <PersonalLine counts={page.counts} />
          <UrlBox />
        </div>
        <div className={styles["inbox"]}>
          <InboxList
            controls={
              showControls ? (
                <Controls
                  changedCount={changedCount}
                  filters={controls.filters}
                  sort={controls.sort}
                  onClear={state.clear}
                />
              ) : undefined
            }
            items={page.items}
            sort={state.choices.sort}
          />
          <Pager
            page={state.choices.page}
            pageSize={page.pageSize}
            total={page.total}
            onPage={(next) =>
              state.write((live) => ({
                page: typeof next === "number" ? next : next(live.page),
              }))
            }
          />
        </div>
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
