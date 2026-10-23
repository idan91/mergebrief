// The hourly dead-credential sweep: a grant no session and no live token
// holds is deleted with its sealed pair, and a token revoked or expired more
// than 30 days ago is deleted outright.
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { sweepDeadCredentials } from "../src/auth/credential-sweep";
import type { GithubGrantRow, OrphanedGrant } from "../src/auth/grant";
import { createSessionAuth } from "../src/auth/session";
import { createTokenAuth } from "../src/auth/token";
import { internal, type AppDatabase } from "../src/db/handle";
import { apiToken } from "../src/schema/api-token";
import { githubGrant } from "../src/schema/github-grant";
import {
  isReviewerId,
  type ApiTokenRowId,
  type ReviewerId,
} from "../src/types";
import { AccessLevels } from "types/access-levels";
import {
  brandWith,
  freshDatabase,
  makeGrant,
  registerSharedPglite,
} from "./helpers";

const shared = registerSharedPglite();

const USER: ReviewerId = brandWith(isReviewerId, 777n);
const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Liveness reads the database clock, so the fixtures sit around the real now.
const NOW = new Date();
const BACKLOG_GRANTS = 501;

async function runCredentialSweep(handle: AppDatabase) {
  const orphanedGrants: OrphanedGrant[] = [];
  const tokensDeleted = await sweepDeadCredentials(handle, NOW, (grants) => {
    orphanedGrants.push(...grants);
  });
  return { orphanedGrants, tokensDeleted };
}

function shiftDays(days: number): Date {
  return new Date(NOW.getTime() + days * MS_PER_DAY);
}

async function makeToken(
  grant: GithubGrantRow,
  name: string,
  expiresAt: Date | null = null,
): Promise<ApiTokenRowId> {
  const minted = await createTokenAuth(shared.handle).mintToken({
    userId: USER,
    name,
    scope: AccessLevels.READ,
    tokenHash: name.padEnd(64, "0"),
    grantId: grant.id,
    expiresAt,
  });
  return minted.id;
}

async function makeRevokedToken(
  grant: GithubGrantRow,
  name: string,
  revokedAt: Date,
): Promise<ApiTokenRowId> {
  const id = await makeToken(grant, name);
  await createTokenAuth(shared.handle).revokeToken(USER, id, revokedAt);
  return id;
}

async function readGrantIds(): Promise<bigint[]> {
  const rows = await internal(shared.handle)
    .select({ id: githubGrant.id })
    .from(githubGrant);
  return rows.map((row) => row.id);
}

async function readTokenGrantId(
  id: ApiTokenRowId,
): Promise<bigint | null | undefined> {
  const rows = await internal(shared.handle)
    .select({ grantId: apiToken.grantId })
    .from(apiToken)
    .where(eq(apiToken.id, id));
  return rows[0]?.grantId;
}

describe("sweepDeadCredentials: grants", () => {
  it("deletes a grant only a revoked token holds and keeps the token row", async () => {
    const grant = await makeGrant(shared.handle, USER);
    const tokenId = await makeRevokedToken(grant, "revoked", shiftDays(-1));

    const swept = await runCredentialSweep(shared.handle);

    expect(swept.orphanedGrants).toEqual([
      {
        id: grant.id,
        ghTokenCiphertext: grant.ghTokenCiphertext,
        keyRef: grant.keyRef,
      },
    ]);
    expect(await readGrantIds()).toEqual([]);
    expect(await readTokenGrantId(tokenId)).toBeNull();
  });

  it("deletes a grant only an expired token holds", async () => {
    const grant = await makeGrant(shared.handle, USER);
    await makeToken(grant, "expired", shiftDays(-1));

    const swept = await runCredentialSweep(shared.handle);

    expect(swept.orphanedGrants.map((dead) => dead.id)).toEqual([grant.id]);
    expect(await readGrantIds()).toEqual([]);
  });

  it("keeps a grant one live token still holds", async () => {
    const grant = await makeGrant(shared.handle, USER);
    await makeRevokedToken(grant, "revoked", shiftDays(-1));
    await makeToken(grant, "live", shiftDays(5));

    const swept = await runCredentialSweep(shared.handle);

    expect(swept.orphanedGrants).toEqual([]);
    expect(await readGrantIds()).toEqual([grant.id]);
  });

  it("keeps a grant a session still holds", async () => {
    const grant = await makeGrant(shared.handle, USER);
    await makeRevokedToken(grant, "revoked", shiftDays(-1));
    await createSessionAuth(shared.handle).createSession({
      sessionTokenHash: "s".repeat(64),
      reviewerId: USER,
      grantId: grant.id,
      expiresAt: shiftDays(5),
    });

    const swept = await runCredentialSweep(shared.handle);

    expect(swept.orphanedGrants).toEqual([]);
    expect(await readGrantIds()).toEqual([grant.id]);
  });

  it("keeps a grant no row references yet, as a sign-in leaves it", async () => {
    const grant = await makeGrant(shared.handle, USER);

    const swept = await runCredentialSweep(shared.handle);

    expect(swept.orphanedGrants).toEqual([]);
    expect(await readGrantIds()).toEqual([grant.id]);
  });

  it("drains a backlog larger than one batch in a single call", async () => {
    const grant = await makeGrant(shared.handle, USER);
    const db = internal(shared.handle);
    await db.execute(
      sql`insert into github_grant (user_id, gh_token_ciphertext, gh_refresh_token_ciphertext, key_ref, refresh_expires_at)
          select ${USER}, 'v2.backlog', 'v2.backlog', ${grant.keyRef}, ${shiftDays(30)}
          from generate_series(1, ${BACKLOG_GRANTS - 1})`,
    );
    await db.execute(
      sql`insert into api_token (token_hash, user_id, name, scope, grant_id, revoked_at)
          select 'backlog-' || g.id, ${USER}, 'backlog', ${AccessLevels.READ}, g.id, ${shiftDays(-1)}
          from github_grant g`,
    );

    const swept = await runCredentialSweep(shared.handle);

    expect(swept.orphanedGrants).toHaveLength(BACKLOG_GRANTS);
    expect(await readGrantIds()).toEqual([]);
  });
});

describe("sweepDeadCredentials: tokens", () => {
  it("deletes a token revoked 31 days ago and keeps one revoked 29 days ago", async () => {
    const grant = await makeGrant(shared.handle, USER);
    const old = await makeRevokedToken(grant, "old", shiftDays(-31));
    const recent = await makeRevokedToken(grant, "recent", shiftDays(-29));

    const swept = await runCredentialSweep(shared.handle);

    expect(swept.tokensDeleted).toBe(1);
    expect(await readTokenGrantId(old)).toBeUndefined();
    expect(await readTokenGrantId(recent)).toBeNull();
  });

  it("deletes a token that expired 31 days ago", async () => {
    const grant = await makeGrant(shared.handle, USER);
    const expired = await makeToken(grant, "expired", shiftDays(-31));

    const swept = await runCredentialSweep(shared.handle);

    expect(swept.tokensDeleted).toBe(1);
    expect(await readTokenGrantId(expired)).toBeUndefined();
  });

  it("keeps a live token that never expires", async () => {
    const grant = await makeGrant(shared.handle, USER);
    const live = await makeToken(grant, "forever");

    const swept = await runCredentialSweep(shared.handle);

    expect(swept.tokensDeleted).toBe(0);
    expect(await readTokenGrantId(live)).toBe(grant.id);
  });
});

describe("sweepDeadCredentials: a failing batch", () => {
  it("hands over the grants an earlier batch deleted before it throws", async () => {
    const handle = await freshDatabase();
    const grant = await makeGrant(handle, USER);
    const tokens = createTokenAuth(handle);
    const minted = await tokens.mintToken({
      userId: USER,
      name: "old",
      scope: AccessLevels.READ,
      tokenHash: "o".padEnd(64, "0"),
      grantId: grant.id,
      expiresAt: null,
    });
    await tokens.revokeToken(USER, minted.id, shiftDays(-31));
    const db = internal(handle);
    await db.execute(
      sql`create function refuse_token_delete() returns trigger language plpgsql
          as $$ begin raise exception 'token delete refused'; end $$`,
    );
    await db.execute(
      sql`create trigger refuse_token_delete before delete on api_token
          for each row execute function refuse_token_delete()`,
    );
    const handedOver: OrphanedGrant[] = [];

    const sweep = sweepDeadCredentials(handle, NOW, (grants) => {
      handedOver.push(...grants);
    });

    await expect(sweep).rejects.toThrow(/delete from "api_token"/);
    expect(handedOver.map((orphan) => orphan.id)).toEqual([grant.id]);
  });
});
