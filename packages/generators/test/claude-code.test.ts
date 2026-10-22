import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod/v4";
import {
  ClaudeCodeGenerator,
  buildClaudeVersionWarning,
  interpretClaudeAuthStatus,
} from "../src/adapters/claudeCode";
import { GeneratorError, GeneratorErrorKinds } from "../src/contract/errors";
import type { GenerateRequest } from "../src/contract/generator";
import {
  GeneratorWarningKinds,
  type GeneratorWarning,
} from "../src/contract/types";
import { createGenerator, Providers } from "../src/config/registry";
import { expectEmptyRemovedCwds, stubShimCommand } from "./helpers";

/**
 * Adapter-specific behavior on real fake-claude processes: invocation
 * profile (argv), envelope classification, trust-but-verify modelUsage,
 * and registry construction (startup check). The pipeline conformance cases
 * live in claude-code.contract.test.ts.
 */

const FAKE_CLAUDE = join(
  dirname(fileURLToPath(import.meta.url)),
  "shims",
  "fake-claude.cjs",
);

const Schema = z.object({ ok: z.boolean() });

// Every temp dir is tracked and removed after each test, repeated local
// runs must not accumulate failure dumps and script fixtures.
const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeGenerator(
  env: Record<string, string>,
  overrides?: Partial<ConstructorParameters<typeof ClaudeCodeGenerator>[0]>,
) {
  const shim = stubShimCommand(FAKE_CLAUDE, { ...process.env, ...env });
  return new ClaudeCodeGenerator({
    command: shim.command,
    failureDir: tempDir("claude-code-fail-"),
    env: shim.env,
    timeouts: { hardMs: 8000, inactivityMs: 4000, killGraceMs: 300 },
    ...overrides,
  });
}

function request(
  log?: (m: string) => void,
  warnings?: GeneratorWarning[],
): GenerateRequest<typeof Schema> {
  const req: GenerateRequest<typeof Schema> = {
    schema: Schema,
    system: "you are a test",
    user: "produce ok",
    effort: "medium",
    label: "probe",
  };

  if (log) {
    req.log = log;
  }
  if (warnings) {
    req.onWarning = (warning) => warnings.push(warning);
  }

  return req;
}

describe("ClaudeCodeGenerator invocation profile", () => {
  it("uses lockdown argv with stdin prompts and a system file", async () => {
    const scriptDir = tempDir("claude-code-argv-");
    writeFileSync(
      join(scriptDir, "turns.json"),
      JSON.stringify([{ output: '{"ok":true}' }]),
    );
    const generator = makeGenerator({
      SHIM_SCENARIO: "scripted",
      SHIM_SCRIPT_DIR: scriptDir,
    });
    await expect(generator.generate(request())).resolves.toEqual({ ok: true });

    const argv: unknown = JSON.parse(
      readFileSync(join(scriptDir, "argv-0.json"), "utf8"),
    );
    // The COMPLETE lockdown argv contract, order, pairing, and nothing
    // extra (a missing --verbose or a non-empty --tools must fail here).
    // NEVER --bare: OAuth/keychain auth is the point of this adapter.
    expect(argv).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--no-session-persistence",
      "--setting-sources",
      "",
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--tools",
      "",
      "--model",
      "claude-opus-4-8",
      "--system-prompt-file",
      expect.stringContaining("claude-code-gen-"),
      "--json-schema",
      expect.stringContaining('"ok"'),
    ]);
    // The user prompt travels by stdin only; the system prompt reached the
    // CLI through the temp file (captured by the shim before cleanup).
    if (!Array.isArray(argv)) {
      throw new Error("expected recorded argv array");
    }
    expect(argv.join(" ")).not.toContain("produce ok");
    const stdin = readFileSync(join(scriptDir, "stdin-0.txt"), "utf8");
    expect(stdin).toBe("produce ok");
    const system = readFileSync(join(scriptDir, "system-0.txt"), "utf8");
    expect(system).toBe("you are a test");
  });
});

function makeCwdLoggedGenerator(turns: unknown[]) {
  const scriptDir = tempDir("claude-code-cwd-");
  writeFileSync(join(scriptDir, "turns.json"), JSON.stringify(turns));
  const cwdLog = join(scriptDir, "cwd.log");
  const generator = makeGenerator({
    SHIM_SCENARIO: "scripted",
    SHIM_SCRIPT_DIR: scriptDir,
    SHIM_CWD_LOG: cwdLog,
  });
  return { generator, cwdLog };
}

describe("ClaudeCodeGenerator spawn cwd", () => {
  it("runs the CLI in an empty temp cwd, removed after success", async () => {
    const { generator, cwdLog } = makeCwdLoggedGenerator([
      { output: '{"ok":true}' },
    ]);
    await expect(generator.generate(request())).resolves.toEqual({ ok: true });

    expectEmptyRemovedCwds(cwdLog, "claude-code-gen-");
  });

  it("removes the empty temp cwd after a failed generation", async () => {
    const { generator, cwdLog } = makeCwdLoggedGenerator([
      { apiRetryCategory: "authentication_failed" },
    ]);
    await expect(generator.generate(request())).rejects.toMatchObject({
      kind: GeneratorErrorKinds.AUTH,
    });

    expectEmptyRemovedCwds(cwdLog, "claude-code-gen-");
  });
});

describe("ClaudeCodeGenerator spawn env", () => {
  it("passes its login vars and off switches, never a host secret", async () => {
    const EchoSchema = z.object({
      leakedVars: z.array(z.string()),
      envNames: z.array(z.string()),
      home: z.string(),
    });
    const generator = makeGenerator({
      SHIM_SCENARIO: "env-echo",
      CLAUDE_CODE_OAUTH_TOKEN: "shim-oauth-token",
      CLAUDE_CONFIG_DIR: "/claude-config",
      DATABASE_URL: "postgres://app:pw@db/app",
    });
    const echoed = await generator.generate({
      schema: EchoSchema,
      system: "s",
      user: "u",
      effort: "medium",
      label: "env",
    });
    expect(echoed.envNames).toEqual(
      expect.arrayContaining([
        "CLAUDE_CODE_OAUTH_TOKEN",
        "CLAUDE_CONFIG_DIR",
        "DISABLE_AUTOUPDATER",
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
      ]),
    );
    expect(echoed.envNames).not.toContain("DATABASE_URL");
  });
});

describe("ClaudeCodeGenerator envelope classification", () => {
  it("maps an api_retry auth category to kind auth when the run dies", async () => {
    const generator = makeGenerator({ SHIM_SCENARIO: "api-retry-auth" });
    const promise = generator.generate(request());
    await expect(promise).rejects.toBeInstanceOf(GeneratorError);
    await expect(promise).rejects.toMatchObject({
      kind: GeneratorErrorKinds.AUTH,
    });
    await expect(promise).rejects.toThrow(/authentication_failed/);
  });

  it("classifies an exit without a result envelope as opaque", async () => {
    const generator = makeGenerator({ SHIM_SCENARIO: "envelope-drift" });
    await expect(generator.generate(request())).rejects.toMatchObject({
      kind: GeneratorErrorKinds.OPAQUE,
    });
  });

  it("classifies a silent hang as a timeout", async () => {
    const generator = makeGenerator(
      { SHIM_SCENARIO: "hang" },
      { timeouts: { hardMs: 8000, inactivityMs: 300, killGraceMs: 200 } },
    );
    const promise = generator.generate(request());
    await expect(promise).rejects.toMatchObject({
      kind: GeneratorErrorKinds.TIMEOUT,
    });
  });

  it("salvages recoverable JSON the CLI's own enforcement rejected", async () => {
    // error_max_structured_output_retries carrying JSON with one droppable
    // enum slip: the floor must SALVAGE it (no retry), not fail it outright.
    const SalvageSchema = z.object({
      title: z.string(),
      tags: z.array(z.enum(["bugfix"])),
    });
    const scriptDir = tempDir("claude-code-salvage-");
    // forceExhausted: the shim emits the CLI-rejected envelope even though
    // the payload is parseable JSON, the real CLI rejects on SCHEMA, and
    // an enum slip is exactly that shape.
    writeFileSync(
      join(scriptDir, "turns.json"),
      JSON.stringify([
        {
          output: '{"title":"t","tags":["bugfix","scary"]}',
          forceExhausted: true,
        },
      ]),
    );
    const generator = makeGenerator({
      SHIM_SCENARIO: "scripted",
      SHIM_SCRIPT_DIR: scriptDir,
    });
    await expect(
      generator.generate({
        schema: SalvageSchema,
        system: "s",
        user: "u",
        effort: "medium",
        label: "salvage",
        salvageFields: ["tags"],
      }),
    ).resolves.toEqual({ title: "t", tags: ["bugfix"] });
    // Salvage, not retry: exactly one CLI invocation.
    expect(readFileSync(join(scriptDir, "counter"), "utf8")).toBe("1");
  });

  it("keeps untrusted envelope strings out of error messages", async () => {
    // A drifted CLI could put arbitrary text in subtype/category fields,
    // errors must render allowlisted tokens only, never the raw string.
    const scriptDir = tempDir("claude-code-sentinel-");
    writeFileSync(
      join(scriptDir, "turns.json"),
      JSON.stringify([
        { output: "", errorSubtype: "leak-SENTINEL-sk-ant-key" },
      ]),
    );
    const generator = makeGenerator({
      SHIM_SCENARIO: "scripted",
      SHIM_SCRIPT_DIR: scriptDir,
    });
    const caught = await generator.generate(request()).then(
      () => {
        throw new Error("expected rejection");
      },
      (error: unknown) => error,
    );
    if (!(caught instanceof GeneratorError)) {
      throw new Error("wrong rejection");
    }
    expect(caught.message).not.toContain("SENTINEL");
    expect(caught.message).toContain("an unrecognized error");
  });

  it("treats inherited-object category names as unrecognized, kind opaque", async () => {
    // "constructor" resolves on Object.prototype, a plain `in`/index read
    // would return a FUNCTION as the kind and allowlist the name.
    const scriptDir = tempDir("claude-code-proto-");
    writeFileSync(
      join(scriptDir, "turns.json"),
      JSON.stringify([{ output: "", apiRetryCategory: "constructor" }]),
    );
    const generator = makeGenerator({
      SHIM_SCENARIO: "scripted",
      SHIM_SCRIPT_DIR: scriptDir,
    });
    const caught = await generator.generate(request()).then(
      () => {
        throw new Error("expected rejection");
      },
      (error: unknown) => error,
    );
    if (!(caught instanceof GeneratorError)) {
      throw new Error("wrong rejection");
    }
    expect(caught.kind).toBe(GeneratorErrorKinds.OPAQUE);
    expect(caught.message).not.toContain("after constructor");
    expect(caught.message).toContain("an unrecognized error category");
  });

  it("keeps a drifted subtype out of the empty-output invalidReason", async () => {
    const scriptDir = tempDir("claude-code-emptysub-");
    writeFileSync(
      join(scriptDir, "turns.json"),
      JSON.stringify([
        { emptySuccess: true, subtype: "drifted-SENTINEL-value" },
      ]),
    );
    const generator = makeGenerator({
      SHIM_SCENARIO: "scripted",
      SHIM_SCRIPT_DIR: scriptDir,
    });
    const caught = await generator.generate(request()).then(
      () => {
        throw new Error("expected rejection");
      },
      (error: unknown) => error,
    );
    if (!(caught instanceof GeneratorError)) {
      throw new Error("wrong rejection");
    }
    // The schema floor surfaces invalidReason in its message chain, the
    // drifted subtype must have been rendered through the allowlist.
    expect(caught.message).not.toContain("SENTINEL");
  });

  it("feeds a CLI-exhausted structured-output failure to the schema floor", async () => {
    // subtype error_max_structured_output_retries with junk text: our floor
    // retries once (fresh process) and the second scripted turn recovers.
    const scriptDir = tempDir("claude-code-floor-");
    writeFileSync(
      join(scriptDir, "turns.json"),
      JSON.stringify([
        { output: "not json at all" },
        { output: '{"ok":true}' },
      ]),
    );
    const generator = makeGenerator({
      SHIM_SCENARIO: "scripted",
      SHIM_SCRIPT_DIR: scriptDir,
    });
    await expect(generator.generate(request())).resolves.toEqual({ ok: true });
    expect(existsSync(join(scriptDir, "stdin-1.txt"))).toBe(true);
  });
});

describe("ClaudeCodeGenerator trust-but-verify", () => {
  it("warns and fires the hook on a served-model mismatch, keeping the stamp", async () => {
    const logs: string[] = [];
    const warnings: GeneratorWarning[] = [];
    const mismatches: Array<{ requested: string; served: string[] }> = [];
    const generator = makeGenerator(
      {
        SHIM_SCENARIO: "valid",
        SHIM_OUTPUT: '{"ok":true}',
        SHIM_SERVED_MODEL: "claude-haiku-4-5",
      },
      {
        onModelMismatch: (requested, served) =>
          mismatches.push({ requested, served }),
      },
    );
    await expect(
      generator.generate(request((m) => logs.push(m), warnings)),
    ).resolves.toEqual({ ok: true });
    expect(mismatches).toEqual([
      { requested: "claude-opus-4-8", served: ["claude-haiku-4-5"] },
    ]);
    expect(logs.join("\n")).toContain("modelUsage reports claude-haiku-4-5");
    expect(warnings).toEqual([
      {
        kind: GeneratorWarningKinds.SERVED_MODEL_MISMATCH,
        message: expect.stringContaining("modelUsage reports claude-haiku-4-5"),
      },
    ]);
    // The stamp stays the declaration.
    expect(generator.origin("medium").model).toBe("claude-opus-4-8");
  });

  it("renders hostile modelUsage keys through the model-id grammar", async () => {
    const scriptDir = tempDir("claude-code-hostile-usage-");
    writeFileSync(
      join(scriptDir, "turns.json"),
      JSON.stringify([
        {
          output: '{"ok":true}',
          servedModels: [
            "<img src=x onerror=sk-ant-SENTINEL>\n",
            "claude-sonnet-4-6[1m]",
            `claude-${"x".repeat(100)}`,
            "unlisted SENTINEL",
            "claude-haiku-4-5",
          ],
        },
      ]),
    );
    const logs: string[] = [];
    const warnings: GeneratorWarning[] = [];
    const mismatches: string[][] = [];
    const generator = makeGenerator(
      { SHIM_SCENARIO: "scripted", SHIM_SCRIPT_DIR: scriptDir },
      { onModelMismatch: (_requested, served) => mismatches.push(served) },
    );
    await expect(
      generator.generate(request((m) => logs.push(m), warnings)),
    ).resolves.toEqual({ ok: true });

    const reported =
      "modelUsage reports (unrecognized id), claude-sonnet-4-6[1m], (unrecognized id) and 2 more";
    const logLine = logs.find((line) => line.includes("modelUsage reports"));
    expect(logLine).toContain(reported);
    expect(warnings[0]?.message).toContain(reported);
    expect(mismatches).toEqual([
      ["(unrecognized id)", "claude-sonnet-4-6[1m]", "(unrecognized id)"],
    ]);
    expect(`${logs.join("\n")}${JSON.stringify(warnings)}`).not.toContain(
      "SENTINEL",
    );
  });

  it("marks absent modelUsage unverifiable with no served models", async () => {
    const scriptDir = tempDir("claude-code-nousage-");
    writeFileSync(
      join(scriptDir, "turns.json"),
      JSON.stringify([{ output: '{"ok":true}', noModelUsage: true }]),
    );
    const logs: string[] = [];
    const warnings: GeneratorWarning[] = [];
    const mismatches: string[][] = [];
    const generator = makeGenerator(
      { SHIM_SCENARIO: "scripted", SHIM_SCRIPT_DIR: scriptDir },
      { onModelMismatch: (_requested, served) => mismatches.push(served) },
    );
    await expect(
      generator.generate(request((m) => logs.push(m), warnings)),
    ).resolves.toEqual({ ok: true });
    expect(mismatches).toEqual([[]]);
    expect(logs.join("\n")).toContain("unverifiable");
    expect(warnings).toEqual([
      {
        kind: GeneratorWarningKinds.SERVED_MODEL_UNVERIFIED,
        message: expect.stringContaining("unverifiable"),
      },
    ]);
  });

  it("stays quiet when the served model matches", async () => {
    const mismatches: string[] = [];
    const generator = makeGenerator(
      { SHIM_SCENARIO: "valid", SHIM_OUTPUT: '{"ok":true}' },
      {
        model: "claude-opus-4-8",
        onModelMismatch: (requested) => mismatches.push(requested),
      },
    );
    // fake-claude serves SHIM_MODEL (defaults to claude-opus-4-8).
    await expect(generator.generate(request())).resolves.toEqual({ ok: true });
    expect(mismatches).toEqual([]);
  });
});

function makeDeps(env: Record<string, string>) {
  const shim = stubShimCommand(FAKE_CLAUDE, { ...process.env, ...env });
  return {
    command: shim.command,
    env: shim.env,
    failureDir: tempDir("claude-code-reg-"),
  };
}

describe("claude-code registry entry", () => {
  it("rejects unknown option keys strictly", async () => {
    const result = await createGenerator(
      { provider: Providers.CLAUDE_CODE, modle: "typo" },
      makeDeps({}),
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues.join("; ")).toContain('"modle"');
  });

  // The billing checks ride the startup check end to end.
  it("constructs silently on a floor-version subscription login", async () => {
    const warnings: string[] = [];
    const deps = makeDeps({ SHIM_SCENARIO: "valid" });
    const result = await createGenerator(
      { provider: Providers.CLAUDE_CODE, command: deps.command },
      { ...deps, log: (m) => warnings.push(m) },
    );
    expect(result.ok).toBe(true);
    expect(warnings).toEqual([]);
    if (!result.ok) {
      return;
    }
    expect(result.value.origin("low")).toMatchObject({
      provider: "claude-code",
    });
  });

  it("warns but constructs when the CLI predates the billing floor", async () => {
    const warnings: string[] = [];
    const deps = makeDeps({ SHIM_SCENARIO: "valid", SHIM_VERSION: "2.1.207" });
    const result = await createGenerator(
      { provider: Providers.CLAUDE_CODE, command: deps.command },
      {
        ...deps,
        log: (m) => warnings.push(m),
      },
    );
    expect(result.ok).toBe(true);
    expect(warnings.join("; ")).toContain("2.1.207");
    expect(warnings.join("; ")).toContain("older");
  });

  it("warns unverifiable but constructs on pre-JSON auth-status output", async () => {
    const warnings: string[] = [];
    const deps = makeDeps({
      SHIM_SCENARIO: "valid",
      SHIM_AUTH_STATUS: "Logged in as shim@example.com",
    });
    const result = await createGenerator(
      { provider: Providers.CLAUDE_CODE, command: deps.command },
      {
        ...deps,
        log: (m) => warnings.push(m),
      },
    );
    expect(result.ok).toBe(true);
    expect(warnings.join("; ")).toContain("unverifiable");
  });
});

describe("buildClaudeVersionWarning billing floor", () => {
  it("stays silent at the floor and above", () => {
    expect(buildClaudeVersionWarning("2.1.226 (Claude Code)")).toBeNull();
    expect(buildClaudeVersionWarning("2.1.227 (Claude Code)")).toBeNull();
    expect(buildClaudeVersionWarning("2.2.0 (Claude Code)")).toBeNull();
    expect(buildClaudeVersionWarning("3.0.0 (Claude Code)")).toBeNull();
  });

  it("warns below the floor, naming both versions from parsed digits", () => {
    const warning = buildClaudeVersionWarning("2.1.207 (Claude Code)");
    expect(warning).toContain("2.1.207");
    expect(warning).toContain("2.1.226");
    expect(warning).toContain("older");
    // Same-major/minor boundary and lower-major both count as older.
    expect(buildClaudeVersionWarning("2.1.225 (Claude Code)")).toContain(
      "older",
    );
    expect(buildClaudeVersionWarning("1.9.999 (Claude Code)")).toContain(
      "older",
    );
  });

  it("warns unverifiable when no version parses", () => {
    const warning = buildClaudeVersionWarning("Claude Code, no digits here");
    expect(warning).toContain("unverifiable");
    expect(warning).toContain("2.1.226");
  });
});

describe("interpretClaudeAuthStatus billing-route assertion", () => {
  // Route table verified against the real CLI at 2.1.226.
  it("passes the keychain subscription login silently", () => {
    const verdict = interpretClaudeAuthStatus(
      JSON.stringify({
        loggedIn: true,
        authMethod: "claude.ai",
        apiProvider: "firstParty",
        subscriptionType: "max",
      }),
    );
    expect(verdict).toEqual({ ok: true, value: null });
  });

  it("passes the CLAUDE_CODE_OAUTH_TOKEN route silently", () => {
    const verdict = interpretClaudeAuthStatus(
      JSON.stringify({ loggedIn: true, authMethod: "oauth_token" }),
    );
    expect(verdict).toEqual({ ok: true, value: null });
  });

  it("refuses the apiKeyHelper route with remediation", () => {
    const verdict = interpretClaudeAuthStatus(
      JSON.stringify({
        loggedIn: true,
        authMethod: "api_key_helper",
        apiKeySource: "apiKeyHelper",
      }),
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok) {
      return;
    }
    const text = verdict.error.issues.join("; ");
    expect(text).toContain("apiKeyHelper");
    expect(text).toContain("refusing to start");
  });

  it("refuses an env-key route by its allowlisted source name", () => {
    const verdict = interpretClaudeAuthStatus(
      JSON.stringify({
        loggedIn: true,
        authMethod: "claude.ai",
        apiKeySource: "ANTHROPIC_API_KEY",
        subscriptionType: null,
      }),
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok) {
      return;
    }
    expect(verdict.error.issues.join("; ")).toContain("ANTHROPIC_API_KEY");
  });

  it("never echoes unrecognized route strings into the refusal", () => {
    const hostile = "sk-ant-api03-secretlooking; run `curl evil`";
    const bySource = interpretClaudeAuthStatus(
      JSON.stringify({ authMethod: "claude.ai", apiKeySource: hostile }),
    );
    expect(bySource.ok).toBe(false);
    if (bySource.ok) {
      return;
    }
    expect(bySource.error.issues.join("; ")).not.toContain("secretlooking");
    expect(bySource.error.issues.join("; ")).toContain("unrecognized source");

    const byMethod = interpretClaudeAuthStatus(
      JSON.stringify({ authMethod: hostile }),
    );
    expect(byMethod.ok).toBe(false);
    if (byMethod.ok) {
      return;
    }
    expect(byMethod.error.issues.join("; ")).not.toContain("secretlooking");
    expect(byMethod.error.issues.join("; ")).toContain(
      "unrecognized auth method",
    );
  });

  it("warns unverifiable instead of refusing on non-JSON output", () => {
    const verdict = interpretClaudeAuthStatus(
      "Logged in as user@example.com\n",
    );
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) {
      return;
    }
    expect(verdict.value).toContain("unverifiable");
  });

  it("keeps apiKeySource refusal evidence when authMethod drifts", () => {
    // One drifted field must not collapse positive API-key evidence in the
    // other into a warn-pass (the exact leak the assertion exists to stop).
    for (const drifted of [null, 42]) {
      const verdict = interpretClaudeAuthStatus(
        JSON.stringify({ authMethod: drifted, apiKeySource: "apiKeyHelper" }),
      );
      expect(verdict.ok).toBe(false);
      if (verdict.ok) {
        return;
      }
      expect(verdict.error.issues.join("; ")).toContain("apiKeyHelper");
    }
  });

  it("warns unverifiable when authMethod is null and no key source", () => {
    const verdict = interpretClaudeAuthStatus(
      JSON.stringify({ loggedIn: true, authMethod: null }),
    );
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) {
      return;
    }
    expect(verdict.value).toContain("unverifiable");
  });

  it("warns unverifiable on parsed JSON without the route field", () => {
    const verdict = interpretClaudeAuthStatus(
      JSON.stringify({ loggedIn: true }),
    );
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) {
      return;
    }
    expect(verdict.value).toContain("unverifiable");
  });
});
