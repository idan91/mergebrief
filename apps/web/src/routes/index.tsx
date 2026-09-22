import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Header } from "@web/components/Header/Header";
import {
  ShortcutsModal,
  type ShortcutSection,
} from "@web/components/ShortcutsModal/ShortcutsModal";
import { AccountMenu } from "@web/features/account";
import { buildViewerQueryOptions } from "../features/account/queries";
import { LocalBriefsSection } from "@web/features/brief";
import { buildLocalBriefsQueryOptions } from "../features/brief/queries";
import { briefErrorDetail } from "@web/features/brief/utils";
import {
  Controls,
  EmptyInbox,
  FailedInbox,
  InboxList,
  NoInstallationLine,
  Pager,
  PersonalLine,
  SignedOutHome,
  UrlBox,
  useControlsFacade,
  useInboxSearchState,
  useHomeShortcuts,
} from "@web/features/inbox";
import { buildInboxQueryOptions } from "../features/inbox/queries";
import {
  countChangedFilters,
  EVERY_STATUS_PARAM,
  hasDefaultStatus,
  parseInboxSearch,
  readInboxParams,
} from "../features/inbox/search";
import {
  InboxEmptinesses,
  InboxStates,
  type InboxPage,
  type InboxSearch,
} from "../features/inbox/types";
import { readInboxEmptiness } from "../features/inbox/utils";
import { appI18n } from "../i18n/I18nProvider";
import { buildPageTitle } from "@web/utils/pageTitle";
import styles from "./index.module.scss";
import sharedStyles from "./routeShared.module.scss";

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
  );
  const state = inbox.data;
  const listShown = state.kind === InboxStates.READY;
  const shortcuts = useHomeShortcuts(listShown);

  let content: ReactNode;
  if (state.kind === InboxStates.SIGNED_OUT) {
    content = <SignedOutHome />;
  } else if (state.kind === InboxStates.FAILED) {
    content = (
      <div className={styles["lead"]}>
        <FailedInbox
          code={state.code}
          onRetry={async () => {
            const result = await inbox.refetch();
            return result.data?.kind === InboxStates.READY;
          }}
        />
        <UrlBox />
      </div>
    );
  } else {
    content = <SignedInHome page={state.page} search={search} />;
  }

  // One shell for every state, so the main landmark survives a state change
  // and focus handed to it after a retry lands on a node that stays.
  return (
    <HomeShell shortcuts={listShown ? shortcuts : undefined}>
      {content}
    </HomeShell>
  );
}

const HOME_SHORTCUTS: ShortcutSection[] = [
  {
    id: "list",
    headingKey: "home.shortcuts.sectionList",
    shortcuts: [
      { keys: ["\u2193"], descriptionKey: "home.shortcuts.cursorDown" },
      { keys: ["J"], descriptionKey: "home.shortcuts.cursorDown" },
      { keys: ["\u2191"], descriptionKey: "home.shortcuts.cursorUp" },
      { keys: ["K"], descriptionKey: "home.shortcuts.cursorUp" },
      { keys: ["Enter"], descriptionKey: "home.shortcuts.openRow" },
      { keys: ["/"], descriptionKey: "home.shortcuts.focusUrl" },
      { keys: ["?"], descriptionKey: "home.shortcuts.toggleShortcuts" },
      { keys: ["Esc"], descriptionKey: "home.shortcuts.closeMenu" },
    ],
  },
];

export interface HomeShellProps {
  children: ReactNode;
  /** Present only where the list is, so the bindings it names exist. */
  shortcuts?: ReturnType<typeof useHomeShortcuts> | undefined;
}

/** The one-tier Header over the full-bleed Home column, whatever the state. */
function HomeShell({ children, shortcuts }: HomeShellProps) {
  return (
    <>
      <Header end={<AccountMenu onOpenShortcuts={shortcuts?.open} />} />
      <main className={styles["home"]} id="main-content" tabIndex={-1}>
        {children}
      </main>
      {shortcuts === undefined ? null : (
        <ShortcutsModal
          close={shortcuts.close}
          open={shortcuts.isOpen}
          sections={HOME_SHORTCUTS}
        />
      )}
    </>
  );
}

export interface SignedInHomeProps {
  page: InboxPage;
  search: InboxSearch;
}

function SignedInHome({ page, search }: SignedInHomeProps) {
  const state = useInboxSearchState(search, page.total, page.pageSize);
  const controls = useControlsFacade(page, search, state.choices, state.write);
  const changedCount = countChangedFilters(search);
  const emptiness = readInboxEmptiness(page, changedCount);
  const noInstallation = page.reachableInstallations.length === 0;

  function showHidden(): void {
    state.write({ state: EVERY_STATUS_PARAM });
  }

  let list: ReactNode = null;
  if (
    emptiness === InboxEmptinesses.FILTERED ||
    emptiness === InboxEmptinesses.HIDDEN_BY_DEFAULT
  ) {
    list = (
      <EmptyInbox
        defaultStatus={hasDefaultStatus(search)}
        reason={emptiness}
        onClear={state.clear}
        onShowHidden={showHidden}
      />
    );
  }

  return (
    <>
      <div className={styles["lead"]}>
        <PersonalLine
          counts={page.counts}
          empty={emptiness === InboxEmptinesses.EMPTY}
        />
        <UrlBox />
        {noInstallation ? (
          <NoInstallationLine installUrl={page.installUrl} />
        ) : null}
      </div>
      {emptiness === InboxEmptinesses.EMPTY ? null : (
        <div className={styles["inbox"]}>
          <InboxList
            controls={
              <Controls
                changedCount={changedCount}
                filters={controls.filters}
                sort={controls.sort}
                onClear={state.clear}
              />
            }
            items={page.items}
            sort={state.choices.sort}
          >
            {list}
          </InboxList>
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
      )}
      {import.meta.env.PROD ? null : <LocalBriefsSection enabled />}
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
