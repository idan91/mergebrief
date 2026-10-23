// A reviewer signed in through the browser or holding an API token: the
// sealed GitHub grant and the session or token row on it. Every route suite
// that needs a principal seeds it here.
import { randomBytes } from "node:crypto";
import {
  createSessionAuth,
  createTokenAuth,
  type AppDatabase,
  type GithubGrantRow,
  type KeyProvider,
  type ReviewerId,
} from "persistence";
import { seedGrant } from "persistence/testing";
import {
  KEY_REF,
  REVIEWER_ID,
  brandReviewerId,
  hashSha256Hex,
} from "./fixtures";
import type { AccessLevel } from "types/access-levels";

export const ACCESS_TOKEN = "ghu_ACCESS_TOKEN_PLAINTEXT";
export const REFRESH_TOKEN = "ghr_REFRESH_TOKEN_PLAINTEXT";

const SIGN_IN_EXPIRES_AT = new Date("2027-01-01T00:00:00Z");

export interface SeededReviewer {
  readonly id: ReviewerId;
  readonly login: string;
}

export interface GrantOptions {
  readonly accessToken?: string;
  readonly refreshToken?: string;
  /** Ends the grant's refresh window, and a sign-in's session with it. */
  readonly expiresAt?: Date;
}

export interface SignInOptions extends GrantOptions {
  readonly reviewer?: SeededReviewer;
}

export interface SeededSignIn {
  readonly cookie: string;
  readonly cookieHash: string;
  readonly grantId: GithubGrantRow["id"];
  readonly reviewerId: ReviewerId;
}

/** The sealed GitHub grant a session or an API token links to. */
async function seedReviewerGrant(
  handle: AppDatabase,
  kp: KeyProvider,
  userId: ReviewerId,
  options: GrantOptions = {},
): Promise<GithubGrantRow["id"]> {
  const grant = await seedGrant(handle, {
    userId,
    accessToken: options.accessToken ?? ACCESS_TOKEN,
    refreshToken: options.refreshToken ?? REFRESH_TOKEN,
    keyProvider: kp,
    keyRef: KEY_REF,
    refreshExpiresAt: options.expiresAt ?? SIGN_IN_EXPIRES_AT,
  });
  return grant.id;
}

export async function seedSignIn(
  handle: AppDatabase,
  kp: KeyProvider,
  options: SignInOptions = {},
): Promise<SeededSignIn> {
  const reviewer = options.reviewer ?? {
    id: brandReviewerId(BigInt(REVIEWER_ID)),
    login: "octocat",
  };
  const expiresAt = options.expiresAt ?? SIGN_IN_EXPIRES_AT;

  const grantId = await seedReviewerGrant(handle, kp, reviewer.id, options);
  const cookie = randomBytes(32).toString("base64url");
  const cookieHash = hashSha256Hex(cookie);
  await createSessionAuth(handle).createSession({
    sessionTokenHash: cookieHash,
    reviewerId: reviewer.id,
    reviewerLogin: reviewer.login,
    grantId,
    expiresAt,
  });

  return { cookie, cookieHash, grantId, reviewerId: reviewer.id };
}

/** An API token at `scope`; returns the Bearer plaintext. */
export async function seedApiToken(
  handle: AppDatabase,
  kp: KeyProvider,
  scope: AccessLevel,
): Promise<string> {
  const plaintext = `mergebrief_${randomBytes(32).toString("base64url")}`;
  const userId = brandReviewerId(BigInt(REVIEWER_ID));
  await createTokenAuth(handle).mintToken({
    scope,
    userId,
    userLogin: "octocat",
    name: "ci-token",
    tokenHash: hashSha256Hex(plaintext),
    grantId: await seedReviewerGrant(handle, kp, userId),
    expiresAt: new Date("2027-01-01T00:00:00Z"),
  });
  return plaintext;
}
