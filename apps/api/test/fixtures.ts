// The identity and auth wiring every route suite builds before it can call
// `createApp`: one encryption key, one OAuth app, and the branded ids the
// tenant scope is keyed by, plus the stored draft row the publish unit tests
// shape. Session-specific seeding lives in `session/fixtures.ts`, which
// builds on these.
import { createHash, randomBytes } from "node:crypto";
import {
  createUserOctokit,
  type OperatorTokenConfig,
  type UserOctokitFactory,
  type UserOctokitOptions,
} from "github";
import {
  createEnvKeyProvider,
  isInstallationId,
  isRepoId,
  isReviewerId,
  type InstallationId,
  type KeyProvider,
  type RepoId,
  type ReviewDraftCommentRow,
  type ReviewerId,
} from "persistence";
import {
  CommentAnchorKinds,
  DiffSides,
  DraftCommentStatuses,
} from "types/comments";

import { vi } from "vitest";
import type { AuthDeps } from "../src/index";

export const SECRET = "test-webhook-secret";
/** What a same-origin browser fetch carries; every cookie mutation sends it. */
export const SAME_ORIGIN_HEADERS = { "sec-fetch-site": "same-origin" } as const;
export const KEY_REF = "SESSION_KEY_V1";
export const INSTALLATION_ID = 987654;
export const REVIEWER_ID = 555;
export const REPO_SLUG = "octo/hello";
export const PR_NUMBER = 7;

export function createKeyProvider(): KeyProvider {
  return createEnvKeyProvider({
    [KEY_REF]: randomBytes(32).toString("base64"),
  });
}

type TestUserOctokit = ReturnType<UserOctokitFactory>;

/**
 * The real factory with the throttle off, since no GitHub is on the other
 * end. Retry stays whatever the caller asked for: a suite that counts calls
 * on a 500 must see a replay when the code under test allows one.
 */
export function createTestUserOctokit(
  accessToken: string,
  options: UserOctokitOptions = {},
): TestUserOctokit {
  return createUserOctokit(accessToken, { ...options, throttle: false });
}

export function buildAuthDeps(kp: KeyProvider): AuthDeps {
  return {
    oauthClientId: "Iv1.test-client-id",
    oauthClientSecret: "test-client-secret",
    keyProvider: kp,
    sessionKeyRef: KEY_REF,
    publicBaseUrl: "https://app.example.test",
    createUserOctokit: createTestUserOctokit,
  };
}

export function hashSha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function brandInstallationId(value: bigint): InstallationId {
  if (!isInstallationId(value)) {
    throw new Error("bad installation id");
  }
  return value;
}

export function brandReviewerId(value: bigint): ReviewerId {
  if (!isReviewerId(value)) {
    throw new Error("bad reviewer id");
  }
  return value;
}

export function brandRepoId(value: bigint): RepoId {
  if (!isRepoId(value)) {
    throw new Error("bad repo id");
  }
  return value;
}

/** An operator token listed for `reviewerIds`, the suites' reviewer by default. */
export function buildOperatorToken(
  token: string,
  reviewerIds: readonly number[] = [REVIEWER_ID],
): OperatorTokenConfig {
  const listed = reviewerIds.map((id) => brandReviewerId(BigInt(id)));
  return { token, reviewerIds: new Set(listed) };
}

export type SentTokens = string[];

/** The credential each call to the stubbed global `fetch` carried, in order. */
export function listSentTokens(): SentTokens {
  return vi.mocked(fetch).mock.calls.map(([input, init]) => {
    const headers = new Headers(
      input instanceof Request ? input.headers : init?.headers,
    );
    const authorization = headers.get("authorization") ?? "";
    return authorization.replace(/^(token|Bearer)\s+/i, "");
  });
}

/** The request URL, whatever shape `fetch` was handed. */
export function getRequestUrl(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

/**
 * The gate's membership listings: `GET /user/installations` answers one
 * reachable installation (`INSTALLATION_ID`), and `GET
 * /user/installations/{id}/repositories` says it holds `repoIds`.
 * `undefined` for every other URL, so a suite's own stub keeps answering
 * the rest.
 */
export function answerInstallationRepositories(
  url: string,
  repoIds: readonly number[],
): Response | undefined {
  const isRepositories =
    url.includes("/user/installations/") && url.includes("/repositories");
  if (isRepositories) {
    return jsonBody({
      total_count: repoIds.length,
      repositories: repoIds.map((id) => ({ id, full_name: REPO_SLUG })),
    });
  }
  if (url.includes("/user/installations")) {
    return answerUserInstallations([INSTALLATION_ID]);
  }
  return undefined;
}

/** `GET /user/installations`: the reachable set is `installationIds`. */
export function answerUserInstallations(
  installationIds: readonly number[],
): Response {
  return jsonBody({
    total_count: installationIds.length,
    installations: installationIds.map((id) => ({
      id,
      account: { login: `org-${id}` },
    })),
  });
}

function jsonBody(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** A held single-line draft on `src/a.ts`; `patch` overrides any field. */
export function makeDraftCommentRow(
  patch: Partial<ReviewDraftCommentRow> = {},
): ReviewDraftCommentRow {
  return {
    id: 1n,
    installationId: 1n,
    reviewSessionId: 10n,
    anchor: {
      kind: CommentAnchorKinds.LINE,
      file: "src/a.ts",
      side: DiffSides.NEW,
      startLine: 12,
      endLine: 12,
    },
    body: "anchored note",
    status: DraftCommentStatuses.DRAFT,
    anchorStatus: null,
    carriedFromSessionId: null,
    carriedFromCommentId: null,
    publishClaim: null,
    publishClaimedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...patch,
  } as ReviewDraftCommentRow;
}
