import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { InboxArchivedFilters } from "types/inbox";

import { Header } from "@web/components/Header";
import { SignInPage } from "@web/components/SignInPage";
import {
  ShortcutsModal,
  type ShortcutSection,
} from "@web/components/ShortcutsModal";
import { AccountMenu } from "@web/features/account";
import { buildViewerQueryOptions } from "../features/account/queries";
import { LocalBriefsSection } from "@web/features/brief";
import { NoticeSurfaces, VersionNotice } from "@web/features/version";
import { buildVersionQueryOptions } from "../features/version/queries";
import { buildLocalBriefsQueryOptions } from "../features/brief/queries";
import { briefErrorDetail } from "@web/features/brief/model";
import {
  Controls,
  EmptyInbox,
  FailedInbox,
  InboxList,
  NoInstallationLine,
  Pager,
  PersonalLine,
  UrlBox,
  useControlsFacade,
  useInboxSearchState,
  useHomeShortcuts,
} from "@web/features/inbox";
import {
  buildInboxQueryOptions,
  readCachedInboxKind,
} from "../features/inbox/queries";
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
import { useReloadOnChange } from "@web/hooks/useReloadOnChange";
import { isDemoBuild } from "@web/utils/demo-build";
import { buildPageTitle } from "@web/utils/pageTitle";
import styles from "./index.module.scss";
import sharedStyles from "./routeShared.module.scss";

export const Route = createFileRoute("/")({
  // The list's state is the URL: unknown values drop, defaults are omitted.
  validateSearch: (search: Record<string, unknown>): InboxSearch =>
    parseInboxSearch(search),
  loaderDeps: ({ search }) => ({
    inbox: readInboxParams(search),
    signInFailure: search.error,
  }),
  // The Inbox and the viewer prefetch in parallel through the in-process
  // apiFetch interface, the same authz gate the browser meets.
  loader: async ({ context, deps }) => {
    // The server render fails fast; the client's own refetch keeps the retries.
    const inboxPrefetch = context.queryClient.ensureQueryData({
      ...buildInboxQueryOptions(deps.inbox),
      retry: false,
    });
    const prefetches: Promise<unknown>[] = [
      inboxPrefetch,
      context.queryClient
        .ensureQueryData({ ...buildViewerQueryOptions(), retry: false })
        .catch(() => undefined),
      // The version notice sits above the content: prefetched so the band
      // renders with the page instead of shifting it after scroll restore.
      context.queryClient.prefetchQuery({
        ...buildVersionQueryOptions(),
        retry: false,
      }),
    ];
    // The DEV file surface, prefetched only behind a session (the readers
    // refuse without one) and never allowed to fail the page. The `if` is a
    // build-time constant, so production keeps the two above.
    if (!import.meta.env.PROD) {
      prefetches.push(
        context.queryClient
          .ensureQueryData(buildInboxQueryOptions(deps.inbox))
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

    // The reason renders only signed out; anywhere else it drops from the address.
    const signedOut = (await inboxPrefetch).kind === InboxStates.SIGNED_OUT;
    const failureOutlivedSignIn =
      deps.signInFailure !== undefined && !signedOut;
    if (failureOutlivedSignIn) {
      throw redirect({
        to: "/",
        search: (previous) =>
          parseInboxSearch({ ...previous, error: undefined }),
        replace: true,
      });
    }

    return { signedOut };
  },
  head: ({ loaderData, match }) => {
    // Home renders the cached inbox, which a read since the last load may have moved.
    const inboxKind = readCachedInboxKind(
      match.context.queryClient,
      match.loaderDeps.inbox,
    );
    let signedOut = loaderData?.signedOut ?? false;
    if (inboxKind !== undefined) {
      signedOut = inboxKind === InboxStates.SIGNED_OUT;
    }
    const pageName = signedOut
      ? appI18n.t("shell.pageTitle.signIn")
      : appI18n.t("shell.pageTitle.home");

    return { meta: [{ title: buildPageTitle(appI18n.t, [pageName]) }] };
  },
  component: Home,
  errorComponent: HomeError,
});

function Home() {
  const { t } = useTranslation();
  const search = Route.useSearch();
  const inbox = useSuspenseQuery(
    buildInboxQueryOptions(readInboxParams(search)),
  );
  const state = inbox.data;
  const listShown = state.kind === InboxStates.READY;
  const signedOut = state.kind === InboxStates.SIGNED_OUT;
  const shortcuts = useHomeShortcuts(listShown);
  useReloadOnChange(signedOut);
  // The hosted demo has no generator behind it, so the box would only refuse.
  const urlBox = isDemoBuild() ? null : <UrlBox />;

  if (signedOut) {
    return (
      <SignInPage
        failure={search.error}
        heading={t("shell.signIn.heading")}
        lead={t("shell.signIn.lead")}
      />
    );
  }

  let content: ReactNode;
  if (state.kind === InboxStates.FAILED) {
    content = (
      <div className={styles["lead"]}>
        <FailedInbox
          code={state.code}
          onRetry={async () => {
            const result = await inbox.refetch();
            return result.data?.kind === InboxStates.READY;
          }}
        />
        {urlBox}
      </div>
    );
  } else {
    content = (
      <SignedInHome page={state.page} search={search} urlBox={urlBox} />
    );
  }

  // One shell for every signed-in state, so the main landmark survives a
  // state change and focus handed to it after a retry lands on a node that stays.
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
      { keys: ["X"], descriptionKey: "home.shortcuts.toggleSelect" },
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

/** The one-tier Header over the full-bleed Home column, whatever the signed-in state. */
function HomeShell({ children, shortcuts }: HomeShellProps) {
  return (
    <div className={styles["page"]}>
      <Header end={<AccountMenu onOpenShortcuts={shortcuts?.open} />} />
      <VersionNotice surface={NoticeSurfaces.HOME} />
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
    </div>
  );
}

export interface SignedInHomeProps {
  page: InboxPage;
  search: InboxSearch;
  /** Absent in the hosted demo, which cannot generate. */
  urlBox: ReactNode;
}

function SignedInHome({ page, search, urlBox }: SignedInHomeProps) {
  const state = useInboxSearchState(search, page.total, page.pageSize);
  const controls = useControlsFacade(page, search, state.choices, state.write);
  const changedCount = countChangedFilters(search);
  const emptiness = readInboxEmptiness(
    page,
    changedCount,
    state.choices.archived,
  );
  const noInstallation = page.reachableInstallations.length === 0;
  const pageKey = JSON.stringify(search);

  function showHidden(): void {
    state.write({ state: EVERY_STATUS_PARAM });
  }
  function showArchived(): void {
    state.write({ archived: InboxArchivedFilters.ONLY });
  }
  function showInbox(): void {
    state.write({ archived: undefined });
  }

  let list: ReactNode = null;
  if (
    emptiness !== InboxEmptinesses.ROWS &&
    emptiness !== InboxEmptinesses.EMPTY
  ) {
    list = (
      <EmptyInbox
        archivedTotal={page.archivedTotal}
        defaultStatus={hasDefaultStatus(search)}
        reason={emptiness}
        onClear={state.clear}
        onShowArchived={showArchived}
        onShowHidden={showHidden}
        onShowInbox={showInbox}
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
        {urlBox}
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
                layout={controls.layout}
                onClear={state.clear}
              />
            }
            items={page.items}
            sort={state.choices.sort}
            layout={state.choices.layout}
            archived={state.choices.archived}
            pageKey={pageKey}
            params={readInboxParams(search)}
            total={page.total}
            pageSize={page.pageSize}
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

export interface HomeErrorProps {
  error: unknown;
}

function HomeError({ error }: HomeErrorProps) {
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
