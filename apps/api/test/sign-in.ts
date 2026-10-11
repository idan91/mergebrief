// A reviewer signed in through the browser or holding an API token: the
// sealed GitHub grant and the session or token row on it. A session row has
// no tenant, so the reviewer is its only identity. Every route suite that
// needs a principal seeds it here.
import { randomBytes } from "node:crypto";
import {
  createGrantAuth,
  createTenantRepository,
  createTokenAuth,
  encryptToken,
  type AppDatabase,
  type GithubGrantRow,
  type KeyProvider,
  type ReviewerId,
  type ScopeContext,
  type WriteClassification,
} from "persistence";
import {
  INSTALLATION_ID,
  KEY_REF,
  REVIEWER_ID,
  brandInstallationId,
  brandReviewerId,
  hashSha256Hex,
} from "./fixtures";

export const ACCESS_TOKEN = "ghu_ACCESS_TOKEN_PLAINTEXT";
export const REFRESH_TOKEN = "ghr_REFRESH_TOKEN_PLAINTEXT";

/** `sessions.create` ignores the scope; the store needs one to open. */
const SESSION_WRITE_SCOPE: ScopeContext = {
  installationId: brandInstallationId(BigInt(INSTALLATION_ID)),
};

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
export async function seedGrant(
  handle: AppDatabase,
  kp: KeyProvider,
  options: GrantOptions = {},
): Promise<GithubGrantRow["id"]> {
  const sealedAccess = await encryptToken(
    kp,
    KEY_REF,
    options.accessToken ?? ACCESS_TOKEN,
  );
  const sealedRefresh = await encryptToken(
    kp,
    KEY_REF,
    options.refreshToken ?? REFRESH_TOKEN,
  );
  if (!sealedAccess.ok || !sealedRefresh.ok) {
    throw new Error("seed encrypt failed");
  }

  const grant = await createGrantAuth(handle).createGrant({
    ghTokenCiphertext: sealedAccess.value,
    ghRefreshTokenCiphertext: sealedRefresh.value,
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

  const grantId = await seedGrant(handle, kp, options);
  const cookie = randomBytes(32).toString("base64url");
  const cookieHash = hashSha256Hex(cookie);
  await createTenantRepository(handle, SESSION_WRITE_SCOPE).sessions.create({
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
  scope: WriteClassification,
): Promise<string> {
  const plaintext = `mergebrief_${randomBytes(32).toString("base64url")}`;
  await createTokenAuth(handle).mintToken({
    scope,
    userId: brandReviewerId(BigInt(REVIEWER_ID)),
    userLogin: "octocat",
    name: "ci-token",
    tokenHash: hashSha256Hex(plaintext),
    grantId: await seedGrant(handle, kp),
    expiresAt: new Date("2027-01-01T00:00:00Z"),
  });
  return plaintext;
}
