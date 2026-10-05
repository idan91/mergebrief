import type { Result, TicketTracker, ValueOf } from "types";
import type { Log } from "../github/types";
import type { ReferenceLocation, TicketUnreadReason } from "../types";
import type { TicketReference, TicketReferenceRepo } from "./references";
import type { TrackerConfig } from "generators/trackers";

/** Provider vocabulary. Each token is a registry entry, never a flag. */
export const ContextProviderTypes = {
  URL: "url",
  GITHUB_ISSUES: "github-issues",
  NOTION: "notion",
} as const;
export type ContextProviderType = ValueOf<typeof ContextProviderTypes>;

/** Cap on any one snippet's text so a huge page can't blow up token cost. */
export const MAX_SNIPPET_CHARS = 20_000;

/**
 * Why a provider could not read what it was asked for: the closed
 * `TicketUnreadReasons` set, so every surface renders one sentence per code
 * and never a raw provider message.
 */
export interface ContextReadFailure {
  readonly reason: TicketUnreadReason;
  /** Operator-facing detail: never a secret, a token, or a page body. */
  readonly detail: string;
  /** GitHub shares one number space: the reference was a pull request, so skip it and read the next. */
  readonly resolvedToPullRequest?: true;
}

/**
 * The metadata tier every provider is asked with: never the diff. Built by
 * `buildContextQuery`, which resolves the primary ticket reference once so
 * every provider sees the same one.
 */
export interface ContextQuery {
  readonly title: string;
  readonly body: string;
  /** Head branch name; "" when unknown. */
  readonly headRef: string;
  readonly repo: TicketReferenceRepo;
  readonly trackers: readonly TrackerConfig[];
  /** The one ticket this PR is about, when a reference was found. */
  readonly primary?: TicketReference | undefined;
  /** Every reference found, primary first; the read falls through when the primary is not a ticket. */
  readonly references: readonly TicketReference[];
}

/** What a provider hands back; the fan-out assigns the per-generation id. */
export interface ProviderSnippet {
  readonly providerId: ContextProviderType;
  /** Canonical, credential-stripped URL: the identity the validator keys on. */
  readonly source: string;
  readonly text: string;
}

/** One fetched piece of untrusted reference text. */
export interface ContextSnippet extends ProviderSnippet {
  /** `ctx-N`, stable within one generation. */
  readonly id: string;
}

/** The primary ticket as a provider read it: text plus the card's facts. */
export interface PrimarySnippet extends ProviderSnippet {
  readonly tracker: TicketTracker;
  /** `PREFIX-N`; "" for a URL-only reference. */
  readonly key: string;
  readonly title: string;
  /** The tracker header line; "" when the tracker has none. */
  readonly header: string;
  readonly foundIn: ReferenceLocation;
}

export type PrimaryTicketOutcome =
  | { readonly status: "read"; readonly snippet: PrimarySnippet }
  | {
      readonly status: "unread";
      readonly reference: TicketReference;
      readonly reason: TicketUnreadReason;
      readonly detail: string;
    };

export interface ContextProviderDeps {
  readonly log: Log;
  /** Aborted by the fan-out once the provider's budget is spent. */
  readonly signal: AbortSignal;
}

/**
 * The port a generic source implements (the URL chaser today). Expected
 * failures come back as a `Result`; a partial read returns the snippets it
 * got. Ticket reads are not providers: they are the trackers' `PrimaryRead`.
 */
export interface ContextProvider {
  readonly providerId: ContextProviderType;
  fetch(
    query: ContextQuery,
    deps: ContextProviderDeps,
  ): Promise<Result<ProviderSnippet[], ContextReadFailure>>;
}
