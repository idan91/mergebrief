import type { Result, ValueOf } from "types/utils";

export const MarkdownTextareaModes = {
  WRITE: "write",
  PREVIEW: "preview",
} as const;

export type MarkdownTextareaMode = ValueOf<typeof MarkdownTextareaModes>;

/** How the mention list sits against the editor while it is open. */
export const MentionListLayouts = {
  /** Under the textarea in the editor's flow: the editor grows by the list. */
  IN_FLOW: "in-flow",
  /** Floats under the textarea over what follows: the editor keeps its height, so a centred host never moves. */
  FLOATING: "floating",
} as const;

export type MentionListLayout = ValueOf<typeof MentionListLayouts>;

/** Why the attach control is off; undefined when an image can go up. */
export const AttachDisabledReasons = {
  NO_SCOPE: "no-scope",
  NOT_INSTALLED: "not-installed",
  REFUSED: "refused",
  NO_PERMISSION: "no-permission",
} as const;
export type AttachDisabledReason = ValueOf<typeof AttachDisabledReasons>;

/** Why a present retry-after header yielded no wait. */
export const RetryAfterRejections = {
  UNRECOGNIZED: "unrecognized",
  OUT_OF_RANGE: "out-of-range",
  INVALID_DATE: "invalid-date",
} as const;
export type RetryAfterRejection = ValueOf<typeof RetryAfterRejections>;

/** Whole seconds to wait, never negative. */
export type RetryAfterParse = Result<number, RetryAfterRejection>;

export const MentionCandidateKinds = {
  USER: "user",
  TEAM: "team",
} as const;
export type MentionCandidateKind = ValueOf<typeof MentionCandidateKinds>;

/**
 * A person the list offers. `name` and `avatarUrl` are optional so thread
 * participants (login-only) and GitHub's search results (rich) ride the same
 * list; insertion always uses the login.
 */
export interface MentionUserCandidate {
  readonly kind: typeof MentionCandidateKinds.USER;
  readonly login: string;
  /** Display name; absent when the user never set one (or the source lacks it). */
  readonly name?: string | undefined;
  readonly avatarUrl?: string | undefined;
}

/** A team the list offers; insertion uses the combined `org/slug`. */
export interface MentionTeamCandidate {
  readonly kind: typeof MentionCandidateKinds.TEAM;
  readonly combinedSlug: `${string}/${string}`;
  readonly name: string;
}

export type MentionCandidate = MentionUserCandidate | MentionTeamCandidate;

/**
 * The caller's answer to the query the editor reported. `query` names the
 * query the candidates answer: the editor adopts a set only for the query
 * being typed now, so a late answer to an older query never replaces a
 * newer one. `pending` holds from the moment a query changes until its
 * answer lands, debounce included; the editor keeps the last adopted set
 * on screen through it.
 */
export interface MentionSuggestions {
  readonly query: string;
  readonly candidates: readonly MentionCandidate[];
  readonly pending: boolean;
}
