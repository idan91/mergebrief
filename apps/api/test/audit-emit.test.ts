// The audit choke point, end to end over the PGlite harness. What this suite
// holds: an action writes exactly ONE row keyed on its descriptor id, a
// denial writes one saying why, a read writes none at all, and the
// private-writes knob switches the one class it is allowed to switch.
import { AuditClientSchema, WriteClassifications } from "persistence";
import type { KeyProvider } from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductActionIds } from "contract";
import {
  createAuditMiddleware,
  stampAuditScope,
  isAuditRowWritten,
  deriveClient,
  deriveRequestId,
} from "../src/product-operations/audit";
import { productRouter } from "../src/product-operations/product-router";
import type { RequestLogEnv } from "../src/request-logging";
import { createProductOperationRegistry } from "../src/product-operations/registry";
import type { Mutable } from "types/utils";
import {
  createApp,
  type ApiApp,
  type AppDeps,
  type AuditEmitConfig,
} from "../src/index";
import { testLogger } from "./logging";
import {
  REPO_ID,
  seedApiToken,
  seedBrief,
  seedPullRequest,
} from "./session/fixtures";
import { seedSignIn } from "./sign-in";
import {
  INSTALLATION_ID,
  OPEN_POLICY,
  brandReviewerId,
  PR_NUMBER,
  REVIEWER_ID,
  SECRET,
  buildAuthDeps,
  createKeyProvider,
  getRequestUrl,
  SAME_ORIGIN_HEADERS,
} from "./fixtures";
import { UNUSED_INSTALLATION_DEPS, stubGateGitHub } from "./reviewer-github";

vi.setConfig({ testTimeout: 20_000 });

interface AuditRow {
  readonly operation: string;
  readonly outcome: string;
  readonly installation_id: string | null;
  readonly classification: string | null;
  readonly channel: string | null;
  readonly credential_id: string | null;
  readonly request_id: string | null;
  readonly client: string | null;
  readonly caller_ip: string | null;
  readonly actor_id: string | null;
  readonly target_type: string | null;
  readonly reason: string | null;
}

/** The choke point's rows. Seeding a Bearer token writes its own issuance row
 * inside the mint transaction, not a request, so not this suite's subject. */
async function auditRows(harness: PgliteHarness): Promise<AuditRow[]> {
  const rows = await harness.raw(
    `select operation, outcome, installation_id, classification, channel,
            credential_id, request_id, client, caller_ip, actor_id,
            target_type, metadata->>'reason' as reason
       from audit_log
      where operation <> 'issue-api-token'
      order by id`,
  );
  return rows.map((row) => ({
    operation: String(row["operation"]),
    outcome: String(row["outcome"]),
    installation_id: stringOrNull(row["installation_id"]),
    classification: stringOrNull(row["classification"]),
    ...OPEN_POLICY,
    channel: stringOrNull(row["channel"]),
    credential_id: stringOrNull(row["credential_id"]),
    request_id: stringOrNull(row["request_id"]),
    client: stringOrNull(row["client"]),
    caller_ip: stringOrNull(row["caller_ip"]),
    actor_id: stringOrNull(row["actor_id"]),
    target_type: stringOrNull(row["target_type"]),
    reason: stringOrNull(row["reason"]),
  }));
}

function stringOrNull(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return null;
}

const CLI_AGENT = "mergebrief/0.1.0";

/** One private-write action: the whole suite acts through it. */
async function readMark(
  app: ApiApp,
  headers: Record<string, string>,
): Promise<Response> {
  return await app.request(
    `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/session/chunks/c1/read?base=base&head=head-1`,
    {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        ...SAME_ORIGIN_HEADERS,
        ...headers,
      },
      body: JSON.stringify({ read: true }),
    },
  );
}

describe("the audit choke point", () => {
  let harness: PgliteHarness;
  let kp: KeyProvider;
  let cookie: string;

  function appWith(audit?: AuditEmitConfig): ApiApp {
    const deps: Mutable<AppDeps> = {
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildAuthDeps(kp),
      ...UNUSED_INSTALLATION_DEPS,
    };

    if (audit !== undefined) {
      deps.audit = audit;
    }

    return createApp(deps);
  }

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = createKeyProvider();
    stubGateGitHub({ repoId: REPO_ID });
    ({ cookie } = await seedSignIn(harness.handle, kp));
    await seedPullRequest(harness.handle);
    await seedBrief(harness.handle, 1);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await harness.close();
  });

  it("writes exactly one row per action, keyed on the descriptor id", async () => {
    const res = await readMark(appWith(), {
      Cookie: `__Host-mergebrief_session=${cookie}`,
      "user-agent": CLI_AGENT,
    });

    expect(res.status).toBe(200);
    const rows = await auditRows(harness);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      operation: "set-chunk-read",
      outcome: "ok",
      // The acting credential's tenant keys the row.
      installation_id: String(INSTALLATION_ID),
      classification: WriteClassifications.PRIVATE_WRITE,
      ...OPEN_POLICY,
      channel: "cookie",
      client: CLI_AGENT,
      actor_id: String(REVIEWER_ID),
      reason: null,
      // The PII flag is off by default, so the column is honestly empty.
      caller_ip: null,
    });
    expect(rows[0]?.credential_id).not.toBeNull();
    expect(rows[0]?.request_id).not.toBeNull();
  });

  it("never records a read, not even a denied one", async () => {
    const app = appWith();
    const read = await app.request(
      `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/session?base=base&head=head-1`,
      { headers: { Cookie: `__Host-mergebrief_session=${cookie}` } },
    );
    expect(read.status).toBe(200);
    expect(await auditRows(harness)).toHaveLength(0);
  });

  it("records a scope denial with its reason token", async () => {
    const readOnly = await seedApiToken(
      harness.handle,
      kp,
      WriteClassifications.READ,
    );

    const res = await readMark(appWith(), {
      Authorization: `Bearer ${readOnly}`,
    });

    expect(res.status).toBe(403);
    const rows = await auditRows(harness);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      operation: "set-chunk-read",
      outcome: "denied",
      installation_id: String(INSTALLATION_ID),
      channel: "bearer",
      reason: "scope-exceeded",
    });
  });

  it("records a repo-access denial the gate collapsed to 404", async () => {
    // The gate answers 404 to leak no existence; the ledger still says why.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (input: string | URL | Request): Promise<Response> =>
          new Response(JSON.stringify({ message: "Not Found" }), {
            status: getRequestUrl(input).includes("/repositories/") ? 404 : 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const res = await readMark(appWith(), {
      Cookie: `__Host-mergebrief_session=${cookie}`,
    });

    expect(res.status).toBe(404);
    const rows = await auditRows(harness);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      operation: "set-chunk-read",
      outcome: "denied",
      reason: "no-repo-access",
      target_type: "repo",
      // A denial resolved no world: the repo is in no reachable installation,
      // so the row files in the url-box world and no tenant can leak.
      installation_id: null,
    });
  });

  it("records a cross-origin cookie mutation as a denial", async () => {
    // A sibling subdomain is same-site, never same-origin; the ledger names
    // the refusal while the wire stays a plain 403.
    const res = await readMark(appWith(), {
      Cookie: `__Host-mergebrief_session=${cookie}`,
      "sec-fetch-site": "same-site",
      origin: "https://evil.example.test",
    });

    expect(res.status).toBe(403);
    const rows = await auditRows(harness);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      operation: "set-chunk-read",
      outcome: "denied",
      reason: "cross-origin",
    });
  });

  it("suppresses private writes under the knob, and denials never", async () => {
    const app = appWith({ privateWrites: false, callerIp: false });
    const ok = await readMark(app, {
      Cookie: `__Host-mergebrief_session=${cookie}`,
    });
    expect(ok.status).toBe(200);
    expect(await auditRows(harness)).toHaveLength(0);

    const readOnly = await seedApiToken(
      harness.handle,
      kp,
      WriteClassifications.READ,
    );
    const refused = await readMark(app, {
      Authorization: `Bearer ${readOnly}`,
    });

    expect(refused.status).toBe(403);
    const rows = await auditRows(harness);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe("denied");
  });

  it("keeps a user-agent that is not a product/version out of the column", async () => {
    const res = await readMark(appWith(), {
      Cookie: `__Host-mergebrief_session=${cookie}`,
      "user-agent": "Idan Ram <idan@example.test> on octo-laptop",
    });

    expect(res.status).toBe(200);
    expect((await auditRows(harness))[0]?.client).toBeNull();
  });

  it("still writes the row when a caller forces an unusable X-Request-Id", async () => {
    // A ledger-rejecting X-Request-Id must not throw the emit and blind the row.
    const res = await readMark(appWith(), {
      Cookie: `__Host-mergebrief_session=${cookie}`,
      "X-Request-Id": `${"a".repeat(80)}=`,
    });

    expect(res.status).toBe(200);
    const rows = await auditRows(harness);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.operation).toBe("set-chunk-read");
    expect(rows[0]?.request_id).toBeNull();
  });
});

/** What a gate contributes: a principal, and a scope that may name another. */
interface StubGateEnv {
  Variables: { session: unknown };
}

describe("the ledger's tenant", () => {
  let harness: PgliteHarness;

  beforeEach(async () => {
    harness = await createPgliteHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it("follows the stamped audit scope over the credential's stored one", async () => {
    const registry = createProductOperationRegistry();
    const root = productRouter<RequestLogEnv>();
    root.use(createAuditMiddleware({ handle: harness.handle, registry }));
    const gated = productRouter<StubGateEnv>();
    gated.use(async (c, next) => {
      c.set("session", {
        id: 1n,
        reviewerId: BigInt(REVIEWER_ID),
        installationId: BigInt(INSTALLATION_ID),
        scope: WriteClassifications.EXTERNAL_WRITE,
        channel: "cookie",
      });
      stampAuditScope(c, { ownerUserId: brandReviewerId(BigInt(REVIEWER_ID)) });
      await next();
    });
    gated.action(
      {
        id: ProductActionIds.SET_CHUNK_READ,
        classification: WriteClassifications.PRIVATE_WRITE,
        ...OPEN_POLICY,
      },
      "put",
      "/read",
      (c) => c.json({ ok: true }),
    );
    root.route("/gated", gated);
    root.commit(registry);

    const res = await root.app.request("/gated/read", { method: "PUT" });

    expect(res.status).toBe(200);
    const rows = await harness.raw(
      "select installation_id, source from audit_log order by id",
    );
    expect(rows).toEqual([{ installation_id: null, source: "url" }]);
  });
});

describe("the emit's two pure rules", () => {
  it("derives this CLI's label, and drops every other user-agent", () => {
    expect(deriveClient(CLI_AGENT)).toBe(CLI_AGENT);
    // A shape check would take all four of these. A caller must not be able
    // to write their own address, or their name, into a keep-forever ledger.
    expect(deriveClient("192.168.4.17/24")).toBeUndefined();
    expect(deriveClient("idan.ram/1.0")).toBeUndefined();
    expect(deriveClient("Mozilla/5.0 (Macintosh; Intel Mac)")).toBeUndefined();
    expect(deriveClient("idan@example.test")).toBeUndefined();
    expect(deriveClient(undefined)).toBeUndefined();
  });

  it("never derives a value the ledger would reject", () => {
    // The two regexes live in different packages, and CI does not run
    // persistence's suite for an api-only edit. A derived value the store
    // refuses would throw inside the emit and lose the WHOLE row, including
    // the denials the config knob is not allowed to switch off.
    const overLong = `mergebrief/${"9".repeat(64)}`;
    const derived = [CLI_AGENT, "mergebrief/0.1.0-rc.1", overLong].map(
      (agent) => deriveClient(agent),
    );
    expect(derived).toEqual([CLI_AGENT, "mergebrief/0.1.0-rc.1", undefined]);
    const accepted = derived
      .filter((value) => value !== undefined)
      .map((value) => AuditClientSchema.safeParse(value).success);
    expect(accepted).toEqual([true, true]);
  });

  it("keeps valid correlation ids and drops ledger-invalid ones", () => {
    // Drops what the ledger schema rejects (65+ chars, `=`), keeps a valid id.
    const kept = "01HXABC-req_9";
    expect(deriveRequestId(kept)).toBe(kept);
    expect(deriveRequestId("a".repeat(65))).toBeUndefined();
    expect(deriveRequestId("abc=def")).toBeUndefined();
    expect(deriveRequestId(undefined)).toBeUndefined();
  });

  it("switches private writes only, and only when they succeeded", () => {
    const cases = [
      [WriteClassifications.PRIVATE_WRITE, "ok", false, false],
      [WriteClassifications.PRIVATE_WRITE, "denied", false, true],
      [WriteClassifications.EXTERNAL_WRITE, "ok", false, true],
      [WriteClassifications.PRIVATE_WRITE, "ok", true, true],
    ] as const;
    for (const [classification, outcome, privateWrites, written] of cases) {
      expect(isAuditRowWritten(classification, outcome, privateWrites)).toBe(
        written,
      );
    }
  });
});
