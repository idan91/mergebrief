import type { NavigateSearch } from "@web/features/brief";
import type { BriefSearchParams } from "@web/features/brief/model";
import type { ThreadRevisionJump } from "@web/features/conversation";
import type { ConversationFilter } from "@web/features/conversation/utils";
import type { PrBriefSearch } from "../../search/types";
import type { PrSummary } from "../../types";
import type { BriefRouteState } from "../../utils/briefRouteState";
import type {
  DbTimelinePoint,
  DbTimelineSelection,
} from "../../utils/dbTimeline";

export interface UsePrBriefPageInput {
  repoId: string;
  prNumber: number;
  search: PrBriefSearch;
  navigate: NavigateSearch<PrBriefSearch>;
}

/** Why the screen takes no writes, shown where the writes would be. */
export interface ReadOnlyReason {
  reason: string;
}

/** Everything the PR page shows except the address port and router state. */
export interface PrBriefPage {
  meta: PrSummary;
  state: BriefRouteState;
  timeline: DbTimelineSelection | undefined;
  /** The demo build, or base drift: the rendered anchors may land wrong on GitHub. */
  readOnly: ReadOnlyReason | undefined;
  /** Head mismatch: writable behind the receipt's ack. */
  staleHead: boolean;
  searchParams: BriefSearchParams;
  conversationFilter: ConversationFilter;
  onConversationFilterChange: (next: ConversationFilter) => void;
  conversationFocusThreadId: number | undefined;
  onSelectRevision: (point: DbTimelinePoint) => void;
  revisionJump: ThreadRevisionJump | undefined;
  /** Present only when a newer briefed revision exists to move to. */
  onGoToNewest: (() => void) | undefined;
}

export interface RevisionPosture {
  /** The current head on a superseded base: read-only. */
  baseDrift: boolean;
  /** The rendered head is not the PR's head. */
  staleHead: boolean;
  newerRevisionSelectable: boolean;
}

export interface ConversationFilterParams {
  conversationFilter: ConversationFilter;
  onConversationFilterChange: (next: ConversationFilter) => void;
}

export interface RevisionWrites {
  goToNewest: () => void;
  selectRevision: (point: DbTimelinePoint) => void;
  /** Outdated-thread jumps; absent when there is no timeline. */
  revisionJump: ThreadRevisionJump | undefined;
}

/** One briefed revision a thread anchor can jump to. */
export interface RevisionSpan {
  headSha: string;
  headIndex: number;
}
