// UI wiring shapes shared by the section digest, the promoted ThreadRowView,
// and the inline (at-chunk) renders — the nearest common ancestor of all
// three subtrees (ADR 0037). Wire shapes stay in `types.ts`.
import type { ReplyResult } from "./reply";
import type { ResolveThreadResult } from "./resolve";

/**
 * Outdated-thread → revision navigation (BRIEF-24 handoff). An outdated thread
 * is anchored on an EARLIER commit; when that commit was itself a briefed head,
 * the reviewer can jump to that revision (with the thread pre-targeted). Misses
 * are COMMON — debounce means many anchors were never briefed heads — so the
 * affordance only enables on a hit; the GitHub permalink is the fallback.
 */
export interface ThreadRevisionJump {
  /** Briefed revision head SHAs a thread anchor can navigate to. */
  readonly knownHeads: ReadonlySet<string>;
  /** Navigate the page to `anchorSha`, pre-targeting `threadId`. */
  readonly onJump: (anchorSha: string, threadId: number) => void;
}

/**
 * Thread resolution as the ROUTE hands it over (BRIEF-93) — the transport plus
 * the capability that decides whether any affordance exists. Absent from a plan
 * means the surface cannot resolve at all (the local demo path), which is the
 * same visible outcome as `canResolve: false`: nothing renders. Fail-closed by
 * construction — an affordance needs a positive capability to appear.
 */
export interface ConversationResolutionPlan {
  /**
   * PR-level, server-derived (push permission OR authorship). MUST come from
   * the PR-META payload: the list payload's `viewerCanResolve` is an
   * authorship-only fallback, so a false there is not a capability denial.
   * GitHub's mutation-time enforcement stays the truth — this only decides
   * whether the button is offered (ADR 0031: hidden, never disabled-dead).
   */
  readonly canResolve: boolean;
  /** Flip one thread; `resolved` picks the route, not a body flag. */
  readonly setResolved: (
    rootCommentId: number,
    resolved: boolean,
  ) => Promise<ResolveThreadResult>;
  /**
   * Refetch PR meta after a 403: GitHub refused a viewer the cached capability
   * said was allowed, so the capability itself is suspect — the buttons must
   * follow refreshed truth rather than the stale boolean that offered them.
   */
  readonly refetchCapability: () => void;
}

/**
 * What a thread row's resolution actions run on: the plan plus the surface's
 * own conversation refetch (the section and the inline renders each own one).
 */
export interface ThreadResolutionWiring extends ConversationResolutionPlan {
  /**
   * Refetch the conversation after a flip — the row transitions into (or out
   * of) the slim variant from REFETCHED truth, never an optimistic local edit.
   * Deliberately its own field rather than reusing the reply's `onPosted`: the
   * resolution flow must not depend on a reply-named callback.
   */
  readonly refetchConversation: () => void;
}

/**
 * The reply transport a thread row's composer posts through. Announce copy,
 * draft reads, and draft writes come from the session stores inside
 * ReplyComposer — only the transport and the refetch hook differ between the
 * section render and the inline (at-chunk) render, so only they ride here.
 */
export interface ThreadComposerWiring {
  readonly briefId: string;
  readonly post: (rootCommentId: number, body: string) => Promise<ReplyResult>;
  /** Refetch after a posted reply — every conversation write evicts server-side. */
  readonly onPosted: () => void;
  /** Outdated-thread revision jump (BRIEF-24); absent inline / on the local path. */
  readonly revisionJump?: ThreadRevisionJump;
  /** Resolve/unresolve + the Reply & resolve combo (BRIEF-93); absent = no affordance. */
  readonly resolution?: ThreadResolutionWiring;
}
