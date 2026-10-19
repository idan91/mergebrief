// The spend command over the real api process: the Operator's verbatim JSON,
// the one TTY line, and the refusal a non-Operator gets.
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createGrantAuth,
  createTokenAuth,
  encryptToken,
  isReviewerId,
} from "persistence";
import { AccessLevels } from "types/access-levels";
import { afterEach, describe, expect, it } from "vitest";
import { createApiClient } from "../src/client";
import { ExitCodes } from "../src/exit";
import { runCli } from "../src/program";
import {
  BASE_URL,
  KEY_REF,
  startCliApiHarness,
  type CliApiHarness,
} from "./harness/api";

const REVIEWER_ID = 555;
const OTHER_ID = 9919;
const DAILY_CAP = 50;

function makeTempDir(prefix: string): string {
  const template = join(tmpdir(), prefix);
  return mkdtempSync(template);
}

function writeConfig(operatorId: number): string {
  const dir = makeTempDir("mb-spend-config-");
  const path = join(dir, "mergebrief.config.yaml");
  writeFileSync(
    path,
    `operators:\n  - ${operatorId}\nspend:\n  maxGenerationsPerDay: ${DAILY_CAP}\n`,
  );
  return path;
}

describe("spend command over the real api app", () => {
  let world: CliApiHarness | undefined;

  afterEach(async () => {
    await world?.close();
  });

  async function startWorld(operatorId: number): Promise<CliApiHarness> {
    world = await startCliApiHarness({ configPath: writeConfig(operatorId) });
    return world;
  }

  async function seedToken(started: CliApiHarness): Promise<string> {
    const plaintext = `mergebrief_${randomBytes(32).toString("base64url")}`;
    const sealedAccess = await encryptToken(
      started.keyProvider,
      KEY_REF,
      "ghu_ACCESS",
    );
    const sealedRefresh = await encryptToken(
      started.keyProvider,
      KEY_REF,
      "ghr_REFRESH",
    );
    if (!sealedAccess.ok) {
      throw new Error("seed encrypt failed");
    }
    if (!sealedRefresh.ok) {
      throw new Error("seed encrypt failed");
    }
    const grant = await createGrantAuth(started.harness.handle).createGrant({
      ghTokenCiphertext: sealedAccess.value,
      ghRefreshTokenCiphertext: sealedRefresh.value,
      keyRef: KEY_REF,
      refreshExpiresAt: new Date("2027-01-01T00:00:00Z"),
    });
    const userId = BigInt(REVIEWER_ID);
    if (!isReviewerId(userId)) {
      throw new Error("bad reviewer id");
    }
    const hash = createHash("sha256").update(plaintext);
    const tokenHash = hash.digest("hex");
    await createTokenAuth(started.harness.handle).mintToken({
      scope: AccessLevels.READ,
      userId,
      name: "ci-token",
      tokenHash,
      grantId: grant.id,
      expiresAt: null,
    });
    return plaintext;
  }

  async function runSpend(started: CliApiHarness, argv: string[]) {
    const token = await seedToken(started);
    const configDir = makeTempDir("mb-config-");
    const cacheDir = makeTempDir("mb-cache-");
    const login = await runCli(
      ["auth", "login", "--base-url", BASE_URL, "--json"],
      {
        fetch: started.fetch,
        env: {},
        configDir,
        cacheDir,
        stdout: () => undefined,
        stderr: () => undefined,
        readStdin: async () => `${token}\n`,
        gitOriginUrl: () => undefined,
      },
    );
    expect(login).toBe(ExitCodes.OK);

    const out: string[] = [];
    const err: string[] = [];
    const code = await runCli(argv, {
      fetch: started.fetch,
      env: {},
      configDir,
      cacheDir,
      stdout: (text) => out.push(text),
      stderr: (line) => err.push(line),
      readStdin: async () => {
        throw new Error("stdin not expected");
      },
      gitOriginUrl: () => undefined,
    });
    const stdout = out.join("");
    return { code, out: stdout, err, token };
  }

  it("spend --json relays the Operator's body verbatim", async () => {
    const started = await startWorld(REVIEWER_ID);

    const run = await runSpend(started, ["spend", "--json"]);
    const reference = await createApiClient({
      fetch: started.fetch,
      baseUrl: BASE_URL,
      token: run.token,
    }).request({ path: "/api/spend" });

    expect(run.code).toBe(ExitCodes.OK);
    expect(run.out).toBe(reference.bodyText);
  });

  it("spend prints today's count against the cap on one line", async () => {
    const started = await startWorld(REVIEWER_ID);

    const run = await runSpend(started, ["spend"]);

    expect(run.code).toBe(ExitCodes.OK);
    expect(run.out).toBe(
      `0 of ${DAILY_CAP} runs started today · resets at 00:00 UTC\n`,
    );
  });

  it("spend refuses a viewer the config does not list", async () => {
    const started = await startWorld(OTHER_ID);

    const run = await runSpend(started, ["spend", "--json"]);

    expect(run.code).not.toBe(ExitCodes.OK);
    expect(run.out).toBe("");
    expect(run.err).toHaveLength(1);
    expect(run.err[0]).toContain("only an operator of this instance");
  });
});
