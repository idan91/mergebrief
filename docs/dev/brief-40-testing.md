# BRIEF-40 — review guide + manual testing runbook (PR #146)

The change moves the GitHub credential pair into `github_grant` (ADR 0018 D15) and
re-anchors refresh on it. Riskiest surfaces: the migration's backfill on live data, and
the refresh orchestrator on the hottest auth path.

## Reviewing the PR

Go commit-by-commit; collapse `drizzle/meta/0013_snapshot.json` (generated, ~half the
diff).

1. `14f10573` — persistence. Load-bearing files, in order:
   - `drizzle/0013_github-grant.sql` — verify the ORDER: create → nullable add →
     backfill → `RAISE EXCEPTION` guard → `SET NOT NULL` + FK → drops LAST. The dedup
     `GROUP BY` is the exact ciphertext triple; the token arm contributes `NULL` to
     `refresh_expires_at` so a mint-chosen token expiry can never leak into the grant.
   - `src/auth/grant.ts` — `refreshGrant` must be the same lock→CAS→callback→patch shape
     `sessionAuth.refreshSession` had on main (diff them side by side);
     `deleteOrphanedGrants` locks candidate grants (sorted) BEFORE the guarded delete.
   - Orphan-clean call sites: `session.ts` deleteSession, `tenant.ts`
     deleteExpired/deleteByReviewer, `purge.ts` purgeInstallation/sweepExpiredSessions —
     each same-transaction.
2. `cb9abdac` — api. One file matters: `routes/auth.ts`. Compare `refreshSessionToken`
   against main's two functions: cookie failure still deletes the session, bearer failure
   deletes nothing, `token.refresh.fail` evt preserved. `tokens.ts` mint: the two
   ciphertext-copy lines are GONE, replaced by `grantId: currentSession.grantId`.
3. `4a52a54a` — review fixes: referent liveness re-check after rotation (cookie:
   `setExpiresAt` touching 0 rows ⇒ NOT_FOUND; bearer: post-rotation `resolveByHash`),
   write-skew lock, test pins.

## Automated coverage map (what is pinned, where)

| Invariant | Test |
|---|---|
| One physical pair after mint (link, never copy) | `api/test/tokens.test.ts` "mints a token…" (grant count = 1, both rows point at it) |
| **Headline behavior: browser rotation does not strand the CLI** | `api/test/reads.test.ts` "BRIEF-40: a browser-triggered rotation…" — full `app.request()` flow, both channels, exactly ONE GitHub exchange |
| CAS branches (apply / short-circuit / reject / not-found) | `persistence/test/grant.test.ts` |
| Orchestrator short-circuit + expiry mirror (bearer may win the rotation) | `api/test/auth.test.ts` "short-circuits on a stale CAS seed" (GitHub token endpoint stubbed to FAIL — proves no exchange) |
| Cookie 401→refresh→retry, one exchange, ciphertext actually rotates (decrypt-compare) | `api/test/reads.test.ts` "401 from GitHub → refresh → retry" |
| Bearer mid-request refresh; token's own expiry never moves | `api/test/tokens.test.ts` "refreshes ONCE mid-request…" (before/after comparison) |
| Referent died mid-rotation: cookie NOT_FOUND, bearer denied w/o row deletion | `api/test/auth.test.ts` (two "mid-rotation" tests) |
| Grant dies with last referent; survives while shared | `persistence/test/session.test.ts`, `grant.test.ts`, `tenant.test.ts`, `purge.test.ts` (grant-count assertions on every delete path) |
| Migration backfill dedup + fallback expiry + column drops, against PRE-migration data | `persistence/test/migration-0013.test.ts` |
| Failure postures + `token.refresh.fail` taxonomy | `api/test/auth.test.ts`, `tokens.test.ts` |
| No credential columns on referent tables (structural) | `persistence/test/session.test.ts`, `token.test.ts` column-inventory pins |

**Honest gaps (known, deliberate):**
- True concurrent lock interleavings (two transactions racing `refreshGrant`; the
  orphan-clean write-skew) — single-connection PGlite cannot express them. The CAS
  short-circuit branch pins the loser's observable behavior; the live interleaving is the
  manual runbook's step 5 / the `/verify` pass.
- `tenant.sessions.deleteExpired` has no production caller (pre-existing dead surface;
  its orphan-clean matches the live `purge.sweepExpiredSessions`, which IS pinned).

## Manual runbook (local instance, real Postgres)

**Step 0 — backup.** The migration drops columns; irreversible.
```sh
docker compose up -d postgres
pg_dump "$DATABASE_URL" > /tmp/pre-brief40.sql
```

**Step 1 — record the pre-migration expectation.**
```sql
-- how many grants the backfill MUST produce:
select count(distinct (gh_token_ciphertext, gh_refresh_token_ciphertext, key_ref)) as expected_grants
from (
  select gh_token_ciphertext, gh_refresh_token_ciphertext, key_ref from reviewer_session
  union all
  select gh_token_ciphertext, gh_refresh_token_ciphertext, key_ref from api_token
) u;
select count(*) as sessions from reviewer_session;
select count(*) as tokens from api_token;
```

**Step 2 — migrate + verify.**
```sh
DATABASE_URL=... pnpm -C packages/persistence migrate
```
```sql
select count(*) from github_grant;              -- == expected_grants from step 1
select count(*) from reviewer_session where grant_id is null;  -- 0 (guard enforced)
select count(*) from api_token where grant_id is null;         -- 0
-- a session and the token minted from it share ONE grant:
select s.grant_id as session_grant, t.grant_id as token_grant
from reviewer_session s, api_token t;           -- eyeball: expected sharing
-- old columns gone:
select column_name from information_schema.columns
where table_name in ('reviewer_session','api_token') and column_name like 'gh_%';  -- empty
```
Row counts for sessions/tokens must match step 1 exactly.

**Step 3 — functional pass** (app running): login → PR list → open a brief → settings:
mint a token → CLI call with it (`mergebrief` or curl `Authorization: Bearer mergebrief_…`
against `/api/pulls`) → token list shows `last_used_at` moving → switch installation →
logout → re-login. Everything should feel identical to before.

**Step 4 — the BRIEF-40 scenario, forced.** Simulate an expired access token by sealing a
garbage one onto the grant (decrypts fine, GitHub rejects it → the refresh path fires with
the still-valid stored refresh token):
```sh
# run from packages/api so the workspace import resolves; use the SERVER's session key
cd packages/api
SESSION_KEY_V1=<server key> pnpm exec tsx -e "
import { encryptToken, envKeyProvider } from 'persistence';
const sealed = await encryptToken(envKeyProvider(), 'SESSION_KEY_V1', 'ghu_invalid_forced');
if (!sealed.ok) throw new Error('encrypt failed');
console.log(sealed.value);"
```
```sql
update github_grant set gh_token_ciphertext = '<output>';  -- your dev row
```
Then: **browser request first** (triggers 401 → rotation → succeeds), then **CLI request**
(must succeed — pre-BRIEF-40 this is the call that died). Repeat in the other order
(corrupt again, CLI first, browser second). Both orders working = the divergence is gone.

**Step 5 — concurrency probe.** Corrupt the access ciphertext again, then fire both
channels at once:
```sh
curl -s -o /dev/null -w '%{http_code}\n' -H "Cookie: rs_session=$COOKIE" $API/… &
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOKEN" $API/… &
wait
```
Both 200. Server log shows at most one rotation; no `token.refresh.fail`. (This is the
real-Postgres race PGlite can't run.)

**Step 6 — lifecycle spot-checks.**
```sql
-- logout while a token still references the grant → grant survives:
--   (logout in browser, then)  select count(*) from github_grant;   -- unchanged
-- revoke the token, then logout the fresh session → revoked token still pins ITS grant
--   (documented D15 consequence; NOT a leak of the fix)
-- delete the revoked token row manually → grant should now be orphan-cleanable only via
--   purge; direct row deletes bypass the seams — don't treat leftover grants here as a bug.
```

**Rollback** if anything looks wrong: `psql "$DATABASE_URL" < /tmp/pre-brief40.sql` and
drop the PR branch — nothing outside the DB changed.
