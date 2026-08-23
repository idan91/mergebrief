// The generate-from-URL port vocabulary — part of the package's public
// surface (`src/index.ts` re-exports it for the startup wiring).
import type { PrLocator } from "brief-core";
import type { Result, ValueOf } from "types";
import type { ReviewerGitHubClient } from "../auth/reviewer-github-client";
import type { SingleFlight } from "./utils";

// Deliberately NO "forbidden" kind: an engine implementation maps a GitHub
// FORBIDDEN onto NOT_FOUND, so a viewer who cannot read a repo sees exactly
// what a nonexistent repo shows (the uniform-404 posture).
export const UrlBriefErrorKind = {
  UNAUTHORIZED: "unauthorized",
  NOT_FOUND: "not-found",
  CONFIG: "config",
  INTERNAL: "internal",
} as const;

export type UrlBriefErrorKind = ValueOf<typeof UrlBriefErrorKind>;

export interface UrlBriefError {
  readonly kind: UrlBriefErrorKind;
  /**
   * Browser-safe text: curated copy or env-var NAMES (config kind) only —
   * never provider-authored or GitHub-authored message content.
   */
  readonly message: string;
}

/** What a generated brief contributes to its briefId. */
export interface GeneratedBriefRef {
  readonly repo: string;
  readonly number: number;
  readonly index: number;
  readonly head: string;
}

/**
 * The generation port the startup wiring injects. Every GitHub read inside
 * runs with the passed viewer token; expected failures come back as `Result`
 * with browser-safe messages (the engine owns detailed server-side logging).
 */
export interface UrlBriefEngine {
  fetchHeadSha(
    locator: PrLocator,
    accessToken: string,
  ): Promise<Result<string, UrlBriefError>>;
  lookupIndex(stem: string, headSha: string): Promise<number | null>;
  generate(
    url: string,
    accessToken: string,
  ): Promise<Result<GeneratedBriefRef, UrlBriefError>>;
}

/** Result-side failures of the generate op; the handler owns the posture. */
export type GenerateFailure =
  | { readonly kind: "token-unreadable" }
  | { readonly kind: "engine-failed"; readonly error: UrlBriefError };

export interface GenerateControllerDeps {
  readonly engine: UrlBriefEngine;
  /** The per-request reviewer channel — one refresh budget across every
   * engine call (the token can expire between head fetch and generation). */
  readonly github: ReviewerGitHubClient;
  /** App-scoped: flights share the engine RESULT, never a Response. */
  readonly singleFlight: SingleFlight<Result<GeneratedBriefRef, UrlBriefError>>;
}
