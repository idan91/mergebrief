import type { QueryClient } from "@tanstack/react-query";
import type { AnyRouter } from "@tanstack/react-router";
import { act } from "@testing-library/react";
import {
  useState,
  type Dispatch,
  type ReactElement,
  type ReactNode,
  type SetStateAction,
} from "react";

import type { ConversationPlan } from "@web/features/conversation";
import type { ConversationFilter } from "@web/features/conversation/utils";
import { I18nProvider } from "@web/i18n/I18nProvider";
import { renderInRouter } from "@web/test/router";
import type { BriefSearchParams } from "./model/comparison/compareState";
import type { LivePrState } from "./model/types";
import type {
  BriefAddress,
  BriefReading,
  BriefReadingSource,
  BriefScreenProps,
  PullRequestContext,
  ReviewCapability,
} from "./screen/components/BriefScreen/types";
import { BriefView } from "./screen/components/BriefView";
import { briefFixture, briefSummaryFixture } from "./fixtures";
import { useBriefReading } from "./screen/hooks/useBriefReading";

const NO_SEARCH_PARAMS: BriefSearchParams = {};
const FIXTURE_LIVE_STATE: LivePrState = { state: "open", draft: false };
const FIXTURE_REPO_ID = "repo-1";

/**
 * The screen's inputs as a test states them, flat; an unset one takes the
 * fixture default. Every mount carries a writable review; `pr` rides with
 * any PR field, `conversation` with a plan.
 */
export interface BriefViewOverrides
  extends
    Partial<BriefReadingSource>,
    Partial<BriefAddress>,
    Partial<PullRequestContext>,
    Partial<ReviewCapability> {
  conversation?: ConversationPlan;
  conversationFocusThreadId?: number | undefined;
  conversationFilter?: ConversationFilter | undefined;
  onConversationFilterChange?: (next: ConversationFilter) => void;
}

interface MountBriefOptions {
  /** A client the test seeded before the mount. */
  queryClient?: QueryClient;
}

interface MountedBrief {
  queryClient: QueryClient;
  router: Pick<AnyRouter, "state">;
}

interface MountedBriefView extends MountedBrief {
  /** Re-renders in place with these props over the current ones. */
  rerender: (overrides: BriefViewOverrides) => void;
}

function ignoreWrite(): void {}

function buildFixtureAddress(overrides: BriefViewOverrides): BriefAddress {
  return {
    searchParams: overrides.searchParams ?? NO_SEARCH_PARAMS,
    link: overrides.link,
    navigateLink: overrides.navigateLink ?? ignoreWrite,
    setFocusParam: overrides.setFocusParam ?? ignoreWrite,
    clearDiffParam: overrides.clearDiffParam ?? ignoreWrite,
    exitChangesScope: overrides.exitChangesScope ?? ignoreWrite,
    revisionPending: overrides.revisionPending ?? false,
  };
}

function buildFixtureReview(overrides: BriefViewOverrides): ReviewCapability {
  return {
    submitReview: overrides.submitReview,
    readOnly: overrides.readOnly,
    staleHead: overrides.staleHead ?? false,
    ownDraft: overrides.ownDraft,
    session: overrides.session,
    sessionReads: overrides.sessionReads,
    writes: overrides.writes,
  };
}

function buildFixtureScreenProps(
  reading: BriefReading,
  overrides: BriefViewOverrides,
): BriefScreenProps {
  const props: BriefScreenProps = {
    reading,
    address: buildFixtureAddress(overrides),
    review: buildFixtureReview(overrides),
  };
  const prGiven =
    overrides.repoId !== undefined ||
    overrides.livePrState !== undefined ||
    overrides.openComparison !== undefined ||
    overrides.headerControls !== undefined;
  if (prGiven) {
    props.pr = {
      livePrState: overrides.livePrState ?? FIXTURE_LIVE_STATE,
      repoId: overrides.repoId ?? FIXTURE_REPO_ID,
      openComparison: overrides.openComparison ?? ignoreWrite,
      headerControls: overrides.headerControls,
    };
  }
  if (overrides.conversation !== undefined) {
    props.conversation = {
      plan: overrides.conversation,
      focusThreadId: overrides.conversationFocusThreadId,
      filter: overrides.conversationFilter,
      onFilterChange: overrides.onConversationFilterChange ?? ignoreWrite,
    };
  }

  return props;
}

export interface FixtureBriefScreenProps {
  overrides: BriefViewOverrides;
}

/** BriefView over the brief fixture: the one place a test builds the screen's props. */
function FixtureBriefScreen({
  overrides,
}: FixtureBriefScreenProps): ReactElement {
  const reading = useBriefReading({
    brief: overrides.brief ?? briefFixture,
    briefId: overrides.briefId ?? briefSummaryFixture.id,
    fileRows: overrides.fileRows,
    comparisonPlan: overrides.comparisonPlan,
    repoConfig: overrides.repoConfig,
    revisions: overrides.revisions,
  });
  const props = buildFixtureScreenProps(reading, overrides);

  return (
    <BriefView
      reading={props.reading}
      address={props.address}
      pr={props.pr}
      review={props.review}
      conversation={props.conversation}
    />
  );
}

export function FixtureBriefView(overrides: BriefViewOverrides): ReactElement {
  return <FixtureBriefScreen overrides={overrides} />;
}

/** Mounts a test's own host around FixtureBriefView in the screen's shell. */
export async function mountBriefHost(
  host: ReactNode,
  options: MountBriefOptions = {},
): Promise<MountedBrief> {
  return await renderInRouter(
    <I18nProvider>{host}</I18nProvider>,
    options.queryClient,
  );
}

/** Mounts the screen at the fixture defaults with these props on top. */
export async function mountBriefView(
  overrides: BriefViewOverrides = {},
  options: MountBriefOptions = {},
): Promise<MountedBriefView> {
  let setProps: Dispatch<SetStateAction<BriefViewOverrides>> | undefined;
  function Stage() {
    const [props, setState] = useState(overrides);
    setProps = setState;
    return <FixtureBriefScreen overrides={props} />;
  }

  const mounted = await mountBriefHost(<Stage />, options);
  return {
    ...mounted,
    rerender: (next) => {
      act(() => {
        setProps?.((current) => ({ ...current, ...next }));
      });
    },
  };
}
