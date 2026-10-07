// The capabilities command: the third CLI-synthesized shape. Join arms per
// map entry, the --require fail-closed matrix, the fingerprint warning, and
// tolerant-read on unknown server fields, over a stub client. One runCli pass
// wires the real command against the real map.
import { createHash, randomBytes } from "node:crypto";
import {
  encryptToken,
  createGrantAuth,
  isReviewerId,
  createTokenAuth,
  WriteClassifications,
} from "persistence";
import { describe, expect, it } from "vitest";
import type { ApiClient } from "../src/client";
import { CLI_VERSION } from "../src/client";
import {
  runCapabilities,
  type CapabilitiesRunDeps,
} from "../src/commands/capabilities";
import { CliError, ExitCodes } from "../src/exit";
import type { ReadIo } from "../src/commands/read";
import { CLI_CATALOG_FINGERPRINT } from "../src/generated-catalog-fingerprint";
import { runCli, type CliDeps } from "../src/program";
import { startCliApiHarness } from "./harness/api";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SERVER_FINGERPRINT = "f".repeat(64);

const GAP = {
  reason: "not yet",
  owner: "idan",
  ticket: "BRIEF-201",
  expiry: "2099-01-01",
};
const WEB_ONLY = { reason: "browser flow", owner: "idan" };

const MAP = {
  "read-pull": { command: "mergebrief pr" },
  "submit-review": { gap: GAP },
  "mint-token": { webOnly: WEB_ONLY },
  "read-gone": { command: "mergebrief gone" },
};

const OPERATIONS = [
  {
    id: "read-pull",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/x",
    futureField: "passes through",
  },
  {
    id: "submit-review",
    kind: "action",
    classification: "external-write",
    endpoint: "POST /api/x",
  },
  {
    id: "mint-token",
    kind: "action",
    classification: "private-write",
    endpoint: "POST /api/y",
  },
  {
    id: "brand-new-op",
    kind: "query",
    classification: "read",
    endpoint: "GET /api/z",
  },
];

function stubClient(body: unknown): ApiClient {
  return {
    request: async () => ({ status: 200, bodyText: JSON.stringify(body) }),
  };
}

interface Capture {
  readonly out: string[];
  readonly err: string[];
  readonly io: ReadIo;
}

function capture(json: boolean): Capture {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      stdout: (text) => out.push(text),
      stderr: (line) => err.push(line),
      json,
    },
  };
}

function deps(overrides: Partial<CapabilitiesRunDeps>): CapabilitiesRunDeps {
  return {
    client: stubClient({
      operations: OPERATIONS,
      catalogFingerprint: SERVER_FINGERPRINT,
    }),
    cliVersion: "9.9.9-test",
    cliCatalogFingerprint: SERVER_FINGERPRINT,
    operationsMapRaw: MAP,
    requireIds: [],
    io: capture(true).io,
    ...overrides,
  };
}

describe("runCapabilities, the synthesized join", () => {
  it("joins every arm: command, gap, webOnly, unknownToCli", async () => {
    const c = capture(true);
    await runCapabilities(deps({ io: c.io }));
    expect(c.err).toEqual([]);
    const body: unknown = JSON.parse(c.out.join(""));
    expect(body).toEqual({
      cliVersion: "9.9.9-test",
      serverCatalogFingerprint: SERVER_FINGERPRINT,
      cliCatalogFingerprint: SERVER_FINGERPRINT,
      fingerprintMatch: true,
      operations: [
        { ...OPERATIONS[0], cli: { command: "mergebrief pr" } },
        { ...OPERATIONS[1], cli: { gap: GAP } },
        { ...OPERATIONS[2], cli: { webOnly: WEB_ONLY } },
        { ...OPERATIONS[3], cli: { unknownToCli: true } },
      ],
    });
  });

  it("warns once on stderr when fingerprints differ; stdout stays pure JSON", async () => {
    const c = capture(true);
    await runCapabilities(
      deps({ io: c.io, cliCatalogFingerprint: "0".repeat(64) }),
    );
    expect(c.err).toHaveLength(1);
    expect(c.err[0]).toContain("fingerprint");
    const body: unknown = JSON.parse(c.out.join(""));
    expect(body).toMatchObject({ fingerprintMatch: false });
  });

  it("renders a human table without --json, which is non-contractual", async () => {
    const c = capture(false);
    await runCapabilities(deps({ io: c.io }));
    const text = c.out.join("");
    expect(text).toContain("read-pull");
    expect(text).toContain("mergebrief pr");
    expect(() => JSON.parse(text)).toThrow(SyntaxError);
  });
});

describe("runCapabilities --require is fail-closed", () => {
  it("passes when every required id maps to a command the server registers", async () => {
    const c = capture(true);
    await runCapabilities(deps({ io: c.io, requireIds: ["read-pull"] }));
    expect(c.err).toEqual([]);
    expect(c.out.join("")).not.toBe("");
  });

  it("fails every bad id with its fact: missing on server, or no CLI command", async () => {
    const c = capture(true);
    const run = runCapabilities(
      deps({
        io: c.io,
        requireIds: [
          "read-gone",
          "submit-review",
          "mint-token",
          "brand-new-op",
          "read-pull",
        ],
      }),
    );
    await expect(run).rejects.toThrow(CliError);
    const error = await run.catch((cause: unknown) => cause);
    if (!(error instanceof CliError)) {
      throw new Error("expected CliError");
    }
    expect(error.code).toBe(ExitCodes.INCOMPATIBLE);
    expect(error.message).toContain("read-gone");
    expect(error.message).toContain("submit-review");
    expect(error.message).toContain("mint-token");
    expect(error.message).toContain("brand-new-op");
    expect(error.message).not.toContain("read-pull");
    expect(c.out).toEqual([]);
  });

  it("suppresses the fingerprint warning when the require check fails", async () => {
    const c = capture(true);
    await runCapabilities(
      deps({
        io: c.io,
        cliCatalogFingerprint: "0".repeat(64),
        requireIds: ["brand-new-op"],
      }),
    ).catch(() => undefined);
    expect(c.err).toEqual([]);
  });
});

function cliDeps(body: unknown): {
  deps: CliDeps;
  out: string[];
  err: string[];
} {
  const configDir = mkdtempSync(join(tmpdir(), "mb-caps-"));
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, "config.json"),
    JSON.stringify({
      defaultProfile: "default",
      profiles: { default: { baseUrl: "https://mb.example" } },
    }),
  );
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    deps: {
      fetch: async (input: string) => {
        if (!input.endsWith("/api/capabilities")) {
          throw new Error(`unexpected fetch: ${input}`);
        }
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      env: { MERGEBRIEF_TOKEN: "mergebrief_test" },
      configDir,
      cacheDir: mkdtempSync(join(tmpdir(), "mb-caps-cache-")),
      stdout: (text) => out.push(text),
      stderr: (line) => err.push(line),
      readStdin: async () => "",
      gitOriginUrl: () => undefined,
    },
  };
}

describe("mergebrief capabilities through runCli", () => {
  const REAL_SHAPED_BODY = {
    // The real committed map maps list-inbox to `mergebrief pr`.
    operations: [
      {
        id: "list-inbox",
        kind: "query",
        classification: "read",
        endpoint: "GET /api/inbox",
      },
    ],
    catalogFingerprint: CLI_CATALOG_FINGERPRINT,
  };

  it("exit 0: emits the synthesized shape with the real map and version", async () => {
    const { deps: d, out, err } = cliDeps(REAL_SHAPED_BODY);
    const code = await runCli(
      ["capabilities", "--json", "--require", "list-inbox"],
      d,
    );
    expect(code).toBe(ExitCodes.OK);
    expect(err).toEqual([]);
    const body: unknown = JSON.parse(out.join(""));
    expect(body).toMatchObject({
      cliVersion: CLI_VERSION,
      fingerprintMatch: true,
      operations: [{ id: "list-inbox", cli: { command: "mergebrief pr" } }],
    });
  });

  it("exit 6 + invariant: empty stdout, one stderr line naming the op", async () => {
    const { deps: d, out, err } = cliDeps(REAL_SHAPED_BODY);
    const code = await runCli(
      ["capabilities", "--json", "--require", "no-such-op"],
      d,
    );
    expect(code).toBe(ExitCodes.INCOMPATIBLE);
    expect(out).toEqual([]);
    expect(err).toHaveLength(1);
    expect(err[0]).toContain("no-such-op");
  });
});

describe("mergebrief capabilities against the real api", () => {
  it("exit 0 with fingerprintMatch true, the wire-shape drift tripwire", async () => {
    const world = await startCliApiHarness();
    const harness = world.harness;
    const kp = world.keyProvider;
    try {
      const reviewerId = BigInt(555);
      if (!isReviewerId(reviewerId)) {
        throw new Error("bad id");
      }
      const sealedAccess = await encryptToken(kp, "SESSION_KEY_V1", "ghu_A");
      const sealedRefresh = await encryptToken(kp, "SESSION_KEY_V1", "ghr_R");
      if (!sealedAccess.ok || !sealedRefresh.ok) {
        throw new Error("seed encrypt failed");
      }
      const grant = await createGrantAuth(harness.handle).createGrant({
        ghTokenCiphertext: sealedAccess.value,
        ghRefreshTokenCiphertext: sealedRefresh.value,
        keyRef: "SESSION_KEY_V1",
        refreshExpiresAt: new Date("2027-01-01T00:00:00Z"),
      });
      const plaintext = `mergebrief_${randomBytes(32).toString("base64url")}`;
      await createTokenAuth(harness.handle).mintToken({
        scope: WriteClassifications.READ,
        userId: reviewerId,
        name: "caps-test",
        tokenHash: createHash("sha256").update(plaintext).digest("hex"),
        grantId: grant.id,
        expiresAt: null,
      });

      const { deps: d, out, err } = cliDeps({});
      const code = await runCli(
        ["capabilities", "--json", "--require", "read-capabilities"],
        {
          ...d,
          fetch: world.fetch,
          env: { MERGEBRIEF_TOKEN: plaintext },
        },
      );
      expect(code).toBe(ExitCodes.OK);
      expect(err).toEqual([]);
      const body: unknown = JSON.parse(out.join(""));
      expect(body).toMatchObject({
        cliVersion: CLI_VERSION,
        serverCatalogFingerprint: CLI_CATALOG_FINGERPRINT,
        fingerprintMatch: true,
      });
    } finally {
      await world.close();
    }
  });
});
