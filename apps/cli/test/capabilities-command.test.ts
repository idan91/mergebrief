// The capabilities command: the third CLI-synthesized shape. Join arms per
// map entry, the --require fail-closed matrix, and tolerant-read on unknown
// server fields, over a stub client. One runCli pass
// wires the real command against the real map.
import { createHash, randomBytes } from "node:crypto";
import { isReviewerId, createTokenAuth } from "persistence";
import { seedGrant } from "persistence/testing";
import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import type { ApiClient } from "../src/client";
import { CLI_VERSION } from "../src/client";
import {
  runCapabilities,
  type CapabilitiesRunDeps,
} from "../src/commands/capabilities/run";
import { CliError, ExitCodes } from "../src/exit";
import { runCli } from "../src/program";
import type { CliDeps, CommandIo } from "../src/types";
import { startCliApiHarness } from "./harness/api";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccessLevels } from "types/access-levels";

const GAP = {
  reason: "not yet",
  owner: "maintainer",
  ticket: "#201",
  expiry: "2099-01-01",
};
const WEB_ONLY = { reason: "browser flow", owner: "maintainer" };

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
    request: async () => ({
      status: 200,
      bodyText: JSON.stringify(body),
      headers: new Headers(),
    }),
  };
}

interface Capture {
  readonly out: string[];
  readonly err: string[];
  readonly io: CommandIo;
}

function capture(): Capture {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      stdout: (text) => out.push(text),
      stderr: (line) => err.push(line),
      successNotice: (line) => err.push(line),
      json: true,
    },
  };
}

function deps(overrides: Partial<CapabilitiesRunDeps>): CapabilitiesRunDeps {
  return {
    client: stubClient({ operations: OPERATIONS }),
    cliVersion: "9.9.9-test",
    operationsMapRaw: MAP,
    requireIds: [],
    io: capture().io,
    ...overrides,
  };
}

describe("runCapabilities, the synthesized join", () => {
  it("joins every arm: command, gap, webOnly, unknownToCli", async () => {
    const c = capture();
    await runCapabilities(deps({ io: c.io }));
    expect(c.err).toEqual([]);
    const body: unknown = JSON.parse(c.out.join(""));
    expect(body).toEqual({
      cliVersion: "9.9.9-test",
      operations: [
        { ...OPERATIONS[0], cli: { command: "mergebrief pr" } },
        { ...OPERATIONS[1], cli: { gap: GAP } },
        { ...OPERATIONS[2], cli: { webOnly: WEB_ONLY } },
        { ...OPERATIONS[3], cli: { unknownToCli: true } },
      ],
    });
  });
});

describe("runCapabilities --require is fail-closed", () => {
  it("fails every bad id with its fact: missing on server, or no CLI command", async () => {
    const c = capture();
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
      operations: [{ id: "list-inbox", cli: { command: "mergebrief pr" } }],
    });
  });

  it("says create, never mint, in every token web-only reason", async () => {
    const { deps: d, out } = cliDeps({
      operations: [
        {
          id: "mint-token",
          kind: "action",
          classification: AccessLevels.PRIVATE_WRITE,
          endpoint: "POST /api/auth/tokens",
        },
        {
          id: "revoke-token",
          kind: "action",
          classification: AccessLevels.PRIVATE_WRITE,
          endpoint: "DELETE /api/auth/tokens/:id",
        },
        {
          id: "revoke-sessions",
          kind: "action",
          classification: AccessLevels.PRIVATE_WRITE,
          endpoint: "DELETE /api/auth/sessions",
        },
      ],
    });

    await runCli(["capabilities", "--json"], d);

    const body: unknown = JSON.parse(out.join(""));
    const parsed = z
      .object({
        operations: z.array(
          z.object({
            cli: z.object({ webOnly: z.object({ reason: z.string() }) }),
          }),
        ),
      })
      .parse(body);
    const reasons = parsed.operations.map(({ cli }) => cli.webOnly.reason);
    expect(reasons).toHaveLength(3);
    expect(reasons[0]).toContain("Creating a credential");
    for (const reason of reasons) {
      expect(reason).not.toMatch(/mint/iu);
    }
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

const joinedBodySchema = z.object({
  cliVersion: z.string(),
  operations: z.array(
    z.object({ id: z.string(), cli: z.record(z.string(), z.unknown()) }),
  ),
});

describe("mergebrief capabilities against the real api", () => {
  it("exit 0 with every server operation known to this CLI", async () => {
    const world = await startCliApiHarness();
    const harness = world.harness;
    const kp = world.keyProvider;
    try {
      const reviewerId = BigInt(555);
      if (!isReviewerId(reviewerId)) {
        throw new Error("bad id");
      }
      const grant = await seedGrant(harness.handle, {
        userId: reviewerId,
        accessToken: "ghu_A",
        refreshToken: "ghr_R",
        keyProvider: kp,
        keyRef: "SESSION_KEY_V1",
        refreshExpiresAt: new Date("2027-01-01T00:00:00Z"),
      });
      const plaintext = `mergebrief_${randomBytes(32).toString("base64url")}`;
      await createTokenAuth(harness.handle).mintToken({
        scope: AccessLevels.READ,
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
      const body = joinedBodySchema.parse(JSON.parse(out.join("")));
      expect(body.cliVersion).toBe(CLI_VERSION);
      expect(body.operations.length).toBeGreaterThan(0);
      expect(
        body.operations.filter((operation) => "unknownToCli" in operation.cli),
      ).toEqual([]);
    } finally {
      await world.close();
    }
  });
});
