import type { Result, ValueOf } from "types";
import type { Log } from "../github/types";

/** Provider vocabulary. Each token is a registry entry, never a flag. */
export const ContextProviderTypes = {
  URL: "url",
} as const;
export type ContextProviderType = ValueOf<typeof ContextProviderTypes>;

/**
 * Why a provider could not read what it was asked for. A closed set: every
 * surface renders one sentence per code, never a raw provider message.
 */
export const ContextReadReasons = {
  NOT_FOUND: "not-found",
  NO_CREDENTIAL: "no-credential",
  TIMEOUT: "timeout",
  RATE_LIMITED: "rate-limited",
  UNSUPPORTED: "unsupported",
} as const;
export type ContextReadReason = ValueOf<typeof ContextReadReasons>;

export interface ContextReadFailure {
  readonly reason: ContextReadReason;
  /** Operator-facing detail: never a secret, a token, or a page body. */
  readonly detail: string;
}

/** The metadata tier every provider is asked with: never the diff. */
export interface ContextQuery {
  readonly title: string;
  readonly body: string;
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

export interface ContextProviderDeps {
  readonly log: Log;
  /** Aborted by the fan-out once the provider's budget is spent. */
  readonly signal: AbortSignal;
}

/**
 * The port every source implements. Expected failures come back as a
 * `Result`; a partial read returns the snippets it got.
 */
export interface ContextProvider {
  readonly providerId: ContextProviderType;
  fetch(
    query: ContextQuery,
    deps: ContextProviderDeps,
  ): Promise<Result<ProviderSnippet[], ContextReadFailure>>;
}
