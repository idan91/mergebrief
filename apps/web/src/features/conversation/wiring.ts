// UI wiring shapes shared by the section digest, the promoted ThreadRowView,
// and the inline (at-chunk) renders — the nearest common ancestor of all
// three subtrees (ADR 0037). Wire shapes stay in `types.ts`.
import type { ReplyResult } from "./reply";

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
}
