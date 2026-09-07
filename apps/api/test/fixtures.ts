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
