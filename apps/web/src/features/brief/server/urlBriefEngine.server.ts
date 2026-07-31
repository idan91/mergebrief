import "@tanstack/react-start/server-only";

import type { UrlBriefEngine, UrlBriefError } from "api";
import { UrlBriefErrorKind } from "api";
import {
  generateAndWrite,
  lookupBriefIndex,
  MAX_COMMENTS,
  normalizeReviewComment,
  type PrLocator,
  type PrMetadata,
  type PrSource,
  type ReviewComment,
} from "brief-core";
import {
  createUserOctokit,
  fetchCompareCommitCount,
  fetchCompareDiff,
  fetchDiff,
  fetchPullRequest,
  fetchPullRequestFiles,
  fetchReviewCommentsRaw,
  GitHubApiErrorCode,
  resolveCommitSha,
  type GitHubApiError,
} from "github";
import type { Result } from "types";

import {
  GeneratorConfigurationError,
  OUT_DIR,
  sharedGeneratorOnce,
} from "./generate.server";
import { getServerLogger } from "../../../server/logger";

const logger = getServerLogger();

/**
 * The api route's UrlBriefEngine over the viewer's token (BRIEF-97): an
 * octokit-backed PrSource feeding the SAME file-backed generation pipeline
 * the gh-CLI path runs. FORBIDDEN folds into NOT_FOUND here — the port's
 * closed error vocabulary has no forbidden member by design (uniform-404
 * posture; see packages/api/src/routes/generate.ts).
 */
class SourceError extends Error {
  readonly kind: UrlBriefError["kind"];

  constructor(error: GitHubApiError) {
    super(error.message);
    this.name = "SourceError";
    this.kind =
      error.code === GitHubApiErrorCode.UNAUTHORIZED
        ? UrlBriefErrorKind.UNAUTHORIZED
        : error.code === GitHubApiErrorCode.NOT_FOUND ||
            error.code === GitHubApiErrorCode.FORBIDDEN
          ? UrlBriefErrorKind.NOT_FOUND
          : UrlBriefErrorKind.INTERNAL;
  }
}

function unwrap<T>(result: Result<T, GitHubApiError>): T {
  if (!result.ok) {
    throw new SourceError(result.error);
  }
  return result.value;
}

function prRef(loc: PrLocator): {
  owner: string;
  repo: string;
  prNumber: number;
} {
  return { owner: loc.owner, repo: loc.repo, prNumber: loc.number };
}

type UserOctokit = ReturnType<typeof createUserOctokit>;

/** A PrSource whose every read runs as the viewer (no gh CLI involved). */
export function octokitPrSource(octokit: UserOctokit): PrSource {
  return {
    async fetchPrMetadata(loc): Promise<PrMetadata> {
      const [info, files] = await Promise.all([
        fetchPullRequest(octokit, prRef(loc)).then(unwrap),
        fetchPullRequestFiles(octokit, prRef(loc)).then(unwrap),
      ]);
      return {
        title: info.title,
        body: info.body,
        url: info.htmlUrl,
        sha: info.headSha,
        baseSha: info.baseSha,
        commitCount: info.commitCount,
        files,
      };
    },
    async fetchPrDiff(loc): Promise<string> {
      return unwrap(await fetchDiff(octokit, prRef(loc)));
    },
    async fetchCompareDiff(loc, baseSha, headSha): Promise<string> {
      return unwrap(
        await fetchCompareDiff(octokit, {
          owner: loc.owner,
          repo: loc.repo,
          base: baseSha,
          head: headSha,
        }),
      );
    },
    async fetchReviewComments(loc): Promise<ReviewComment[]> {
      const raw = unwrap(await fetchReviewCommentsRaw(octokit, prRef(loc)));
      // Same cap as the gh path — prompt-cost bound, door parity.
      return raw
        .slice(0, MAX_COMMENTS)
        .map((comment) => normalizeReviewComment(comment));
    },
    async fetchCompareCommitCount(loc, baseSha, headSha): Promise<number> {
      return unwrap(
        await fetchCompareCommitCount(octokit, {
          owner: loc.owner,
          repo: loc.repo,
          base: baseSha,
          head: headSha,
        }),
      );
    },
    async resolveFullSha(loc, ref): Promise<string> {
      return unwrap(
        await resolveCommitSha(octokit, {
          owner: loc.owner,
          repo: loc.repo,
          ref,
        }),
      );
    },
  };
}

/**
 * Map a thrown failure to the port's Result shape. Message discipline
 * (BRIEF-11): provider/GitHub cause chains never reach the wire — the log
 * line is message-only, and the wire carries curated kinds; only CONFIG
 * passes text (env-var names, clamped again at the route).
 */
function toUrlBriefError(error: unknown, action: string): UrlBriefError {
  if (error instanceof SourceError) {
    // Non-denial GitHub failures (500s, rate limits) need an operator trail —
    // the message is already sanitized by mapRequestError (static context +
    // status only). Denials are routine viewer state, not log-worthy.
    if (error.kind === UrlBriefErrorKind.INTERNAL) {
      logger.warn(
        `urlBriefEngine: ${action} github failure — ${error.message}`,
      );
    }
    return { kind: error.kind, message: "github fetch failed" };
  }
  if (error instanceof GeneratorConfigurationError) {
    return { kind: UrlBriefErrorKind.CONFIG, message: error.message };
  }
  logger.error(
    `urlBriefEngine: ${action} failed — ${error instanceof Error ? error.message : String(error)}`,
  );
  return { kind: UrlBriefErrorKind.INTERNAL, message: "generation failed" };
}

async function run<T>(
  action: string,
  body: () => Promise<T>,
): Promise<Result<T, UrlBriefError>> {
  try {
    return { ok: true, value: await body() };
  } catch (error) {
    return { ok: false, error: toUrlBriefError(error, action) };
  }
}

/**
 * Retry-once-with-PAT wrapper (BRIEF-97 fallback): a GitHub App user token is
 * INSTALLATION-SCOPED by GitHub's design — it cannot read a private repo the
 * App is not installed on, even for the repo's owner. The operator may set
 * `MERGEBRIEF_URL_BOX_TOKEN` (a classic/fine-grained PAT) as the backstop for
 * exactly that case: viewer token first, PAT only after a NOT_FOUND denial.
 * Access-control caveat, documented in .env.example: every signed-in viewer
 * of the instance can generate briefs for anything the PAT can read. The
 * retry is cheap — a denial fails on the FIRST GitHub read, before any model
 * call.
 */
async function withUrlBoxFallback<T>(
  fallbackToken: string | undefined,
  body: (token: string) => Promise<T>,
  viewerToken: string,
): Promise<T> {
  try {
    return await body(viewerToken);
  } catch (error) {
    if (
      fallbackToken !== undefined &&
      error instanceof SourceError &&
      error.kind === UrlBriefErrorKind.NOT_FOUND
    ) {
      return body(fallbackToken);
    }
    throw error;
  }
}

/** The composition root's engine (wired into `createApp` by webhookApp). */
export function createUrlBriefEngine(): UrlBriefEngine {
  // Read once at composition (generate.server's loadEnv already ran).
  const fallbackToken = process.env["MERGEBRIEF_URL_BOX_TOKEN"] || undefined;
  return {
    fetchHeadSha: (locator, accessToken) =>
      run("head fetch", () =>
        withUrlBoxFallback(
          fallbackToken,
          async (token) => {
            const info = unwrap(
              await fetchPullRequest(createUserOctokit(token), prRef(locator)),
            );
            return info.headSha;
          },
          accessToken,
        ),
      ),
    lookupIndex: (stem, headSha) => lookupBriefIndex(OUT_DIR, stem, headSha),
    generate: (url, accessToken) =>
      run("generation", () =>
        withUrlBoxFallback(
          fallbackToken,
          async (token) => {
            const { generator, effort } = await sharedGeneratorOnce();
            const source = octokitPrSource(createUserOctokit(token));
            const brief = await generateAndWrite(
              OUT_DIR,
              url,
              undefined,
              generator,
              () => {},
              effort,
              source,
            );
            return {
              repo: brief.pr.repo,
              number: brief.pr.number,
              index: brief.index,
              head: brief.commitRange.head,
            };
          },
          accessToken,
        ),
      ),
  };
}
