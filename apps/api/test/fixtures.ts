// The identity and auth wiring every route suite builds before it can call
// `createApp`: one encryption key, one OAuth app, and the branded ids the
// tenant scope is keyed by. Session-specific seeding lives in
// `session/fixtures.ts`, which builds on these.
import { createHash, randomBytes } from "node:crypto";
import {
  createEnvKeyProvider,
  isInstallationId,
  isRepoId,
  isReviewerId,
  type InstallationId,
  type KeyProvider,
  type RepoId,
  type ReviewerId,
} from "persistence";

import type { AuthDeps } from "../src/index";

export const SECRET = "test-webhook-secret";
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

export function buildAuthDeps(kp: KeyProvider): AuthDeps {
  return {
    oauthClientId: "Iv1.test-client-id",
    oauthClientSecret: "test-client-secret",
    keyProvider: kp,
    sessionKeyRef: KEY_REF,
    publicBaseUrl: "https://app.example.test",
    cookieSecure: true,
  };
}

export function hashSha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function brandInstallationId(value: bigint): InstallationId {
  if (!isInstallationId(value)) throw new Error("bad installation id");
  return value;
}

export function brandReviewerId(value: bigint): ReviewerId {
  if (!isReviewerId(value)) throw new Error("bad reviewer id");
  return value;
}

export function brandRepoId(value: bigint): RepoId {
  if (!isRepoId(value)) throw new Error("bad repo id");
  return value;
}

/** The request URL, whatever shape `fetch` was handed. */
export function getRequestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
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
