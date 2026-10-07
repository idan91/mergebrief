import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod/v4";
import {
  CURSOR_VERSION_FLOOR,
  CursorGenerator,
  buildCursorVersionWarning,
  interpretCursorAbout,
  resolveCursorTimeouts,
} from "../src/adapters/cursor";
import { GeneratorError, GeneratorErrorKinds } from "../src/contract/errors";
import type { TokenUsage } from "../src/contract/generator";
import {
  GeneratorWarningKinds,
  type GeneratorWarning,
  type GeneratorWarningSink,
} from "../src/contract/types";
import { createGenerator, Providers } from "../src/config/registry";
import { expectEmptyRemovedCwds } from "./helpers";

/**
 * Adapter-specific behavior on real fake-cursor processes: invocation
 * profile (argv/stdin/cwd), envelope classification, stderr-prefix error
 * taxonomy, and the boot-probe interpreters. The pipeline conformance cases
 * (cursor.contract.test.ts) ride the registry-wiring change that makes the
 * adapter constructable.
 */

const FAKE_CURSOR = join(
  dirname(fileURLToPath(import.meta.url)),
  "shims",
  "fake-cursor.cjs",
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
  overrides?: Partial<ConstructorParameters<typeof CursorGenerator>[0]>,
) {
  return new CursorGenerator({
    command: FAKE_CURSOR,
    failureDir: tempDir("cursor-fail-"),
    env: { ...process.env, ...env },
    timeouts: { hardMs: 8000, killGraceMs: 300 },
    ...overrides,
  });
}

function request(extras?: {
  log?: (m: string) => void;
  onUsage?: (usage: TokenUsage) => void;
  onWarning?: GeneratorWarningSink;
}) {
  const req: {
    schema: typeof Schema;
    system: string;
    user: string;
    effort: "medium";
    label: string;
    log?: (m: string) => void;
    onUsage?: (usage: TokenUsage) => void;
    onWarning?: GeneratorWarningSink;
  } = {
    schema: Schema,
    system: "you are a test",
    user: "produce ok",
    effort: "medium",
    label: "probe",
  };
  if (extras?.log) {
    req.log = extras.log;
  }
  if (extras?.onUsage) {
    req.onUsage = extras.onUsage;
  }
  if (extras?.onWarning) {
    req.onWarning = extras.onWarning;
  }
  return req;
}

function scriptedGenerator(turns: unknown[]) {
  const scriptDir = tempDir("cursor-script-");
  writeFileSync(join(scriptDir, "turns.json"), JSON.stringify(turns));
  const cwdLog = join(scriptDir, "cwd.log");
  const generator = makeGenerator({
    SHIM_SCENARIO: "scripted",
    SHIM_SCRIPT_DIR: scriptDir,
    SHIM_CWD_LOG: cwdLog,
  });
  return { generator, scriptDir, cwdLog };
}

async function rejection(promise: Promise<unknown>): Promise<GeneratorError> {
  const caught = await promise.then(
    () => {
      throw new Error("expected rejection");
    },
    (error: unknown) => error,
  );
  if (!(caught instanceof GeneratorError)) {
    throw new Error("wrong rejection");
  }
  return caught;
}

describe("CursorGenerator spawn cwd", () => {
  it("runs the CLI in an empty temp cwd, removed after success", async () => {
    const { generator, cwdLog } = scriptedGenerator([
      { output: '{"ok":true}' },
    ]);
    await expect(generator.generate(request())).resolves.toEqual({ ok: true });

    expectEmptyRemovedCwds(cwdLog, "cursor-gen-");
  });

  it("removes the empty temp cwd after a failed generation", async () => {
    const { generator, cwdLog } = scriptedGenerator([
      { stderr: "Authentication required" },
    ]);
    await expect(generator.generate(request())).rejects.toMatchObject({
      kind: GeneratorErrorKinds.AUTH,
    });

    expectEmptyRemovedCwds(cwdLog, "cursor-gen-");
  });
});

describe("CursorGenerator invocation profile", () => {
  it("runs plan-mode lockdown argv, prompts via stdin", async () => {
    const { generator, scriptDir } = scriptedGenerator([
      { output: '{"ok":true}' },
    ]);
    await expect(generator.generate(request())).resolves.toEqual({ ok: true });

    const argv: unknown = JSON.parse(
      readFileSync(join(scriptDir, "argv-0.json"), "utf8"),
    );
    // The COMPLETE lockdown argv contract, order, pairing, and nothing
    // extra: never --force, never --sandbox, never --api-key. No --model
    // when none is configured (the CLI's own default runs).
    expect(argv).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--mode",
      "plan",
      "--trust",
    ]);
    // System, wire schema, user, and the output contract all travel by
    // stdin (the CLI has no system channel and NO schema flag, the prompt
    // is the only place the model ever sees the schema), in that order.
    const stdin = readFileSync(join(scriptDir, "stdin-0.txt"), "utf8");
    expect(stdin.startsWith("you are a test")).toBe(true);
    const schemaAt = stdin.indexOf('"ok"');
    const userAt = stdin.indexOf("produce ok");
    const contractAt = stdin.indexOf("ONLY the JSON object");
    expect(schemaAt).toBeGreaterThan(0);
    expect(userAt).toBeGreaterThan(schemaAt);
    expect(contractAt).toBeGreaterThan(userAt);
    expect(stdin).toContain("emit empty arrays as []");
  });

  it("sends the configured model id VERBATIM, never a bracket override", async () => {
    // The CLI accepts only --list-models ids; a bracket-decorated id is
    // rejected outright (execution-verified), so effort never decorates it.
    const { generator, scriptDir } = scriptedGenerator([
      { output: '{"ok":true}' },
    ]);
    await expect(
      generator.generate({ ...request(), effort: "high" }),
    ).resolves.toEqual({ ok: true });
    const bare: unknown = JSON.parse(
      readFileSync(join(scriptDir, "argv-0.json"), "utf8"),
    );
    expect(bare).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--mode",
      "plan",
      "--trust",
    ]);
    const withModel = scriptedGenerator([{ output: '{"ok":true}' }]);
    const logs: string[] = [];
    const modelGenerator = makeGenerator(
      {
        SHIM_SCENARIO: "scripted",
        SHIM_SCRIPT_DIR: withModel.scriptDir,
      },
      { model: "gpt-5.2" },
    );
    await expect(
      modelGenerator.generate({
        ...request({ log: (m) => logs.push(m) }),
        effort: "high",
      }),
    ).resolves.toEqual({ ok: true });
    const argv: unknown = JSON.parse(
      readFileSync(join(withModel.scriptDir, "argv-0.json"), "utf8"),
    );
    expect(argv).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--mode",
      "plan",
      "--trust",
      "--model",
      "gpt-5.2",
    ]);
    // Requested effort can't ride a bare id, the gap is logged, not silent.
    expect(logs.join("\n")).toContain("does not ride the wire");
  });

  it("stays quiet when the id variant already carries the requested effort", async () => {
    const { scriptDir } = scriptedGenerator([{ output: '{"ok":true}' }]);
    const logs: string[] = [];
    const generator = makeGenerator(
      { SHIM_SCENARIO: "scripted", SHIM_SCRIPT_DIR: scriptDir },
      { model: "gpt-5.2-high" },
    );
    await expect(
      generator.generate({
        ...request({ log: (m) => logs.push(m) }),
        effort: "high",
      }),
    ).resolves.toEqual({ ok: true });
    expect(logs.join("\n")).not.toContain("does not ride the wire");
  });

  it("stamps effort parsed from the id variant, null outside the vocabulary", () => {
    const cases: Array<[string, "low" | "medium" | "high" | null]> = [
      ["gpt-5.2", null],
      ["gpt-5.2-high", "high"],
      ["gpt-5.2-low-fast", "low"],
      ["cursor-grok-4.6-medium", "medium"],
      ["cursor-grok-4.6-xhigh", null],
    ];
    for (const [model, effort] of cases) {
      expect(makeGenerator({}, { model }).origin("high")).toEqual({
        provider: "cursor",
        model,
        effort,
      });
    }
    const defaulted = makeGenerator({});
    expect(defaulted.origin("high")).toEqual({
      provider: "cursor",
      model: "cursor-default",
      effort: null,
    });
  });
});

describe("CursorGenerator envelope handling", () => {
  it("resolves a schema-valid answer through the floor", async () => {
    const generator = makeGenerator({ SHIM_SCENARIO: "valid" });
    await expect(generator.generate(request())).resolves.toEqual({ ok: true });
  });

  it("recovers JSON the model wrapped in narration, in ONE attempt", async () => {
    // The observed failure shape: plan-mode narration glued to the answer.
    // The extracted candidate must save the attempt (floor-validated), with
    // no feedback retry spent.
    const { generator, scriptDir } = scriptedGenerator([
      {
        output:
          'I\'ll look up the brief schema so the JSON matches.{"ok":true}Done.',
      },
    ]);
    await expect(generator.generate(request())).resolves.toEqual({ ok: true });
    expect(readFileSync(join(scriptDir, "counter"), "utf8")).toBe("1");
  });

  it("still floor-fails narration with no JSON inside", async () => {
    const { generator, scriptDir } = scriptedGenerator([
      { output: "I'll inspect the workspace and report back." },
      { output: "Still thinking about it." },
    ]);
    const caught = await rejection(generator.generate(request()));
    expect(caught.kind).toBe(GeneratorErrorKinds.SCHEMA_FLOOR);
    // Both attempts spent: prose with no JSON is a real schema failure.
    expect(readFileSync(join(scriptDir, "counter"), "utf8")).toBe("2");
  });

  it("skips narration braces and a schema echo to find the real answer", async () => {
    // With the wire schema riding the prompt, a model may echo it (or use
    // braces in prose) BEFORE the answer, the LAST parseable object wins.
    const { generator, scriptDir } = scriptedGenerator([
      {
        output:
          'I\'ll emit {ok, tags} per the schema {"type":"object","properties":{}}. {"ok":true}',
      },
    ]);
    await expect(generator.generate(request())).resolves.toEqual({ ok: true });
    expect(readFileSync(join(scriptDir, "counter"), "utf8")).toBe("1");
  });

  it("reports envelope usage tokens through onUsage", async () => {
    const usages: TokenUsage[] = [];
    const generator = makeGenerator({ SHIM_SCENARIO: "valid" });
    await expect(
      generator.generate(request({ onUsage: (usage) => usages.push(usage) })),
    ).resolves.toEqual({ ok: true });
    // Shim envelope: inputTokens 11 / outputTokens 22 / cacheReadTokens 3
    // (cacheWriteTokens has no TokenUsage slot and is dropped).
    expect(usages).toEqual([
      { inputTokens: 11, outputTokens: 22, cacheReadTokens: 3 },
    ]);
  });

  it("logs the billing route from system/init through the allowlist", async () => {
    const logs: string[] = [];
    const generator = makeGenerator({
      SHIM_SCENARIO: "valid",
      SHIM_API_KEY_SOURCE: "env",
    });
    await expect(
      generator.generate(request({ log: (m) => logs.push(m) })),
    ).resolves.toEqual({ ok: true });
    expect(logs.join("\n")).toContain("apiKeySource: env");
  });

  it("stays quiet on the expected plan permission mode", async () => {
    const logs: string[] = [];
    const generator = makeGenerator({ SHIM_SCENARIO: "valid" });
    await expect(
      generator.generate(request({ log: (m) => logs.push(m) })),
    ).resolves.toEqual({ ok: true });
    expect(logs.join("\n")).not.toContain("lockdown");
  });

  it("warns on a drifted permission mode without echoing it", async () => {
    // The one lockdown claim the CLI makes checkable, silence here would
    // let a drifted CLI run generations with write+shell tools live.
    const logs: string[] = [];
    const warnings: GeneratorWarning[] = [];
    const generator = makeGenerator({
      SHIM_SCENARIO: "valid",
      SHIM_PERMISSION_MODE: "drift-SENTINEL-mode",
    });
    await expect(
      generator.generate(
        request({
          log: (m) => logs.push(m),
          onWarning: (warning) => warnings.push(warning),
        }),
      ),
    ).resolves.toEqual({ ok: true });
    const joined = logs.join("\n");
    expect(joined).toContain("write lockdown is unverified");
    expect(joined).toContain("an unrecognized mode");
    expect(joined).not.toContain("SENTINEL");
    expect(warnings).toEqual([
      {
        kind: GeneratorWarningKinds.PLAN_MODE_UNVERIFIED,
        message: expect.stringContaining("write lockdown is unverified"),
      },
    ]);
    expect(JSON.stringify(warnings)).not.toContain("SENTINEL");
  });

  it("never echoes a drifted apiKeySource into logs", async () => {
    const logs: string[] = [];
    const generator = makeGenerator({
      SHIM_SCENARIO: "valid",
      SHIM_API_KEY_SOURCE: "leak-SENTINEL-value",
    });
    await expect(
      generator.generate(request({ log: (m) => logs.push(m) })),
    ).resolves.toEqual({ ok: true });
    const joined = logs.join("\n");
    expect(joined).not.toContain("SENTINEL");
    expect(joined).toContain("an unrecognized source");
  });

  it("feeds a schema-invalid answer back through one floor retry", async () => {
    const { generator, scriptDir } = scriptedGenerator([
      { output: "not json at all" },
      { output: '{"ok":true}' },
    ]);
    await expect(generator.generate(request())).resolves.toEqual({ ok: true });
    // Fresh process per attempt; the retry prompt stitches system, failed
    // output and validation feedback into one stdin.
    const stdin = readFileSync(join(scriptDir, "stdin-1.txt"), "utf8");
    expect(stdin.startsWith("you are a test")).toBe(true);
    expect(stdin).toContain("[Your previous response]");
    expect(stdin).toContain("not json at all");
    expect(stdin).toContain("failed schema validation");
  });

  it("surfaces an empty answer as a schema-floor failure", async () => {
    const { generator } = scriptedGenerator([{ output: "" }]);
    const caught = await rejection(generator.generate(request()));
    expect(caught.kind).toBe(GeneratorErrorKinds.SCHEMA_FLOOR);
    expect(caught.message).toContain("No output");
  });

  it("reports billed usage even when the envelope is an error", async () => {
    // The tokens were spent before the failure classified, onUsage fires
    // off the envelope, ahead of the error branches.
    const usages: TokenUsage[] = [];
    const { generator } = scriptedGenerator([
      { isError: true, subtype: "error", output: "" },
    ]);
    await rejection(
      generator.generate(request({ onUsage: (usage) => usages.push(usage) })),
    );
    expect(usages).toEqual([
      { inputTokens: 11, outputTokens: 22, cacheReadTokens: 3 },
    ]);
  });

  it("keeps a drifted error subtype out of the message", async () => {
    const { generator } = scriptedGenerator([
      { isError: true, subtype: "drifted-SENTINEL-subtype", output: "" },
    ]);
    const caught = await rejection(generator.generate(request()));
    expect(caught.kind).toBe(GeneratorErrorKinds.OPAQUE);
    expect(caught.message).not.toContain("SENTINEL");
    expect(caught.message).toContain("an unrecognized error");
  });
});

describe("CursorGenerator stderr taxonomy", () => {
  it("classifies the auth prefix without echoing raw stderr", async () => {
    const generator = makeGenerator({ SHIM_SCENARIO: "stderr-auth" });
    const caught = await rejection(generator.generate(request()));
    expect(caught.kind).toBe(GeneratorErrorKinds.AUTH);
    expect(caught.message).toContain("cursor-agent login");
    expect(caught.message).toContain("CURSOR_API_KEY");
    // Fixed text only, the CLI's own phrasing never rides along.
    expect(caught.message).not.toContain("Please run");
  });

  it("classifies a rejected model as config", async () => {
    const generator = makeGenerator({ SHIM_SCENARIO: "stderr-bad-model" });
    const caught = await rejection(generator.generate(request()));
    expect(caught.kind).toBe(GeneratorErrorKinds.CONFIG);
    expect(caught.message).not.toContain("Available models");
  });

  it("still classifies a rejected model when the id list flushes the prefix", async () => {
    // Real-CLI shape: ~200 available ids follow the rejection, pushing
    // "Cannot use this model" out of the 4KB rolling stderr tail.
    const generator = makeGenerator({
      SHIM_SCENARIO: "stderr-exit",
      SHIM_STDERR: `Cannot use this model: bad[effort=high]. Available models: ${Array.from({ length: 300 }, (_, i) => `model-${i}-medium`).join(", ")}\n`,
    });
    const caught = await rejection(generator.generate(request()));
    expect(caught.kind).toBe(GeneratorErrorKinds.CONFIG);
  });

  it("classifies an unknown option as config", async () => {
    const generator = makeGenerator({ SHIM_SCENARIO: "stderr-unknown-option" });
    const caught = await rejection(generator.generate(request()));
    expect(caught.kind).toBe(GeneratorErrorKinds.CONFIG);
  });

  it("falls back to opaque with the exit code and a REDACTED stderr tail", async () => {
    // stderr is cursor's only error channel, an unclassified failure must
    // carry the tail (unlike claude/codex, whose errors ride in-band), with
    // credential-shaped substrings stripped at the redactSecrets boundary.
    const generator = makeGenerator({
      SHIM_SCENARIO: "stderr-exit",
      SHIM_STDERR: "Unknown model family; api_key=sk-SENTINELSECRET\n",
      SHIM_EXIT_CODE: "7",
    });
    const caught = await rejection(generator.generate(request()));
    expect(caught.kind).toBe(GeneratorErrorKinds.OPAQUE);
    expect(caught.message).toContain("7");
    expect(caught.message).toContain("Unknown model family");
    expect(caught.message).toContain("(redacted)");
    expect(caught.message).not.toContain("SENTINELSECRET");
  });

  it("classifies an exit without a result envelope as opaque", async () => {
    const generator = makeGenerator({ SHIM_SCENARIO: "envelope-drift" });
    const caught = await rejection(generator.generate(request()));
    expect(caught.kind).toBe(GeneratorErrorKinds.OPAQUE);
  });

  it("classifies a silent hang as a wall-clock timeout", async () => {
    const generator = makeGenerator(
      { SHIM_SCENARIO: "hang" },
      { timeouts: { hardMs: 400, killGraceMs: 200 } },
    );
    const caught = await rejection(generator.generate(request()));
    expect(caught.kind).toBe(GeneratorErrorKinds.TIMEOUT);
    // The pipe-silent stream means the HARD timer owns the kill, never the
    // inactivity watchdog (which defaults to the same ceiling).
    expect(caught.message).toContain("hard wall-clock");
  });
});

describe("CursorGenerator spawn-env boundary", () => {
  it("strips CURSOR_API_ENDPOINT but lets CURSOR_API_KEY through", async () => {
    // CURSOR_API_KEY is the deliberate survivor: it outranks the stored
    // login in the CLI's auth precedence but bills the SAME subscription
    // pool (the inverse of the claude adapter's refuse-API-key posture).
    // CURSOR_API_ENDPOINT redirects the API host and must never reach a
    // spawn.
    const EchoSchema = z.object({
      leakedVars: z.array(z.string()),
      cwd: z.string(),
    });
    const generator = makeGenerator({
      SHIM_SCENARIO: "env-echo",
      CURSOR_API_KEY: "shim-cursor-key",
      CURSOR_API_ENDPOINT: "https://attacker.example",
      ANTHROPIC_API_KEY: "shim-anthropic-key",
    });
    const echoed = await generator.generate({
      schema: EchoSchema,
      system: "s",
      user: "u",
      effort: "medium",
      label: "env",
    });
    expect(echoed.leakedVars).toContain("CURSOR_API_KEY");
    expect(echoed.leakedVars).not.toContain("CURSOR_API_ENDPOINT");
    expect(echoed.leakedVars).not.toContain("ANTHROPIC_API_KEY");
  });
});

function makeDeps(env: Record<string, string>) {
  return {
    env: { ...process.env, ...env },
    failureDir: tempDir("cursor-reg-"),
  };
}

describe("cursor registry entry", () => {
  it("constructs through the boot probe against the shim", async () => {
    const result = await createGenerator(
      { provider: Providers.CURSOR, command: FAKE_CURSOR },
      makeDeps({ SHIM_SCENARIO: "valid" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.origin("low")).toMatchObject({ provider: "cursor" });
  });

  it("refuses boot when the CLI is logged out though about exits 0", async () => {
    // The exit-blind trap: `about` succeeds either way, only the JSON
    // verdict can refuse.
    const result = await createGenerator(
      { provider: Providers.CURSOR, command: FAKE_CURSOR },
      makeDeps({ SHIM_SCENARIO: "auth-logged-out" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues.join("; ")).toContain("not authenticated");
  });

  it("refuses boot when the binary is missing", async () => {
    const result = await createGenerator(
      { provider: Providers.CURSOR, command: "/nonexistent/cursor-agent" },
      makeDeps({}),
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues.join("; ")).toContain("not found on PATH");
  });

  it("rejects a bracketed model id at config time", async () => {
    const result = await createGenerator(
      {
        provider: Providers.CURSOR,
        command: FAKE_CURSOR,
        model: "gpt-5.2[effort=high]",
      },
      makeDeps({ SHIM_SCENARIO: "valid" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues.join("; ")).toContain(
      "bracket overrides are rejected",
    );
  });

  it("rejects unknown option keys strictly", async () => {
    const result = await createGenerator(
      { provider: Providers.CURSOR, modle: "typo" },
      makeDeps({}),
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues.join("; ")).toContain('"modle"');
  });

  it("warns but constructs when the CLI predates the contract floor", async () => {
    const warnings: string[] = [];
    const result = await createGenerator(
      { provider: Providers.CURSOR, command: FAKE_CURSOR },
      {
        ...makeDeps({
          SHIM_SCENARIO: "valid",
          SHIM_VERSION: "2026.08.20-abcdef0",
        }),
        log: (m) => warnings.push(m),
      },
    );
    expect(result.ok).toBe(true);
    expect(warnings.join("; ")).toContain("2026.08.20");
    expect(warnings.join("; ")).toContain("older");
  });

  it("keeps credential vars out of the probe spawns", async () => {
    // The shim's about arm exits 1 when any stripped-list var reached it,
    // a successful construction here proves the probe went through
    // envForSpawn (CURSOR_API_KEY excepted: the deliberate survivor).
    // Minimal env, not a process.env spread: the vitest runner injects
    // BASE_URL, which the shim's leak regex would flag as a false positive.
    // PATH stays so the shim's `#!/usr/bin/env node` resolves.
    const result = await createGenerator(
      { provider: Providers.CURSOR, command: FAKE_CURSOR },
      {
        env: {
          PATH: process.env["PATH"] ?? "",
          SHIM_SCENARIO: "auth-fail-if-credentials",
          ANTHROPIC_API_KEY: "shim-anthropic-key",
          CURSOR_API_ENDPOINT: "https://attacker.example",
          CURSOR_API_KEY: "shim-cursor-key",
        },
        failureDir: tempDir("cursor-reg-"),
      },
    );
    expect(result.ok).toBe(true);
  });
});

describe("buildCursorVersionWarning headless-contract floor", () => {
  it("stays silent at the floor and above", () => {
    expect(buildCursorVersionWarning("2026.08.25-3e8eec8")).toBeNull();
    expect(buildCursorVersionWarning("2026.08.26-0000000")).toBeNull();
    expect(buildCursorVersionWarning("2026.09.01-abcdef0")).toBeNull();
    expect(buildCursorVersionWarning("2027.01.01")).toBeNull();
  });

  it("ignores the build-hash suffix when comparing", () => {
    // Lexicographically "-0000000" < "-3e8eec8": only the date prefix counts.
    expect(buildCursorVersionWarning("2026.08.25-0000000")).toBeNull();
  });

  it("warns below the floor, naming both versions from parsed digits", () => {
    const warning = buildCursorVersionWarning("2026.08.24-fffffff");
    expect(warning).toContain("2026.08.24");
    expect(warning).toContain(CURSOR_VERSION_FLOOR);
    expect(warning).toContain("older");
    expect(buildCursorVersionWarning("2025.12.31-abcdef0")).toContain("older");
  });

  it("warns unverifiable when no version parses", () => {
    const warning = buildCursorVersionWarning("cursor-agent, no digits");
    expect(warning).toContain("unverifiable");
    expect(warning).toContain(CURSOR_VERSION_FLOOR);
  });
});

describe("interpretCursorAbout auth verdict", () => {
  it("passes silently on an authenticated account", () => {
    const verdict = interpretCursorAbout(
      JSON.stringify({
        cliVersion: "2026.08.25-3e8eec8",
        userEmail: "shim@example.com",
        subscriptionTier: "pro",
        model: "auto",
      }),
    );
    expect(verdict).toEqual({ ok: true, value: null });
  });

  it("passes on partial evidence, a tier without an email", () => {
    const verdict = interpretCursorAbout(
      JSON.stringify({ userEmail: null, subscriptionTier: "pro" }),
    );
    expect(verdict).toEqual({ ok: true, value: null });
  });

  it("refuses boot when both identity fields are null", () => {
    const verdict = interpretCursorAbout(
      JSON.stringify({
        cliVersion: "2026.08.25-3e8eec8",
        userEmail: null,
        subscriptionTier: null,
      }),
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok) {
      return;
    }
    const text = verdict.error.issues.join("; ");
    expect(text).toContain("not authenticated");
    expect(text).toContain("cursor-agent login");
    expect(text).toContain("CURSOR_API_KEY");
  });

  it("treats an empty-string email as no evidence", () => {
    const verdict = interpretCursorAbout(
      JSON.stringify({ userEmail: "", subscriptionTier: null }),
    );
    expect(verdict.ok).toBe(false);
  });

  it("never echoes the account email into any verdict", () => {
    // `about` output carries userEmail, PII that must never reach a
    // message or warning on ANY path (allowlist rendering only).
    const sentinel = "leak-SENTINEL@example.com";
    const pass = interpretCursorAbout(
      JSON.stringify({ userEmail: sentinel, subscriptionTier: "pro" }),
    );
    expect(JSON.stringify(pass)).not.toContain("SENTINEL");

    const drifted = interpretCursorAbout(
      JSON.stringify({ userEmail: sentinel, subscriptionTier: 42 }),
    );
    expect(JSON.stringify(drifted)).not.toContain("SENTINEL");
  });

  it("warns unverifiable instead of refusing on non-JSON output", () => {
    const verdict = interpretCursorAbout("cursor-agent about: plain text\n");
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) {
      return;
    }
    expect(verdict.value).toContain("unverifiable");
  });

  it("warns unverifiable on parsed JSON without the identity fields", () => {
    const verdict = interpretCursorAbout(
      JSON.stringify({ cliVersion: "2026.08.25-3e8eec8" }),
    );
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) {
      return;
    }
    expect(verdict.value).toContain("unverifiable");
  });
});

describe("resolveCursorTimeouts for a stream silent until exit", () => {
  it("defaults the inactivity watchdog to the hard ceiling", () => {
    // With no liveness signal on the pipe, a 3-minute inactivity default
    // would kill every longer run, inactivity must collapse to wall-clock.
    const timeouts = resolveCursorTimeouts(undefined);
    expect(timeouts.inactivityMs).toBe(timeouts.hardMs);
  });

  it("keeps inactivity pinned to an overridden hard ceiling", () => {
    const timeouts = resolveCursorTimeouts({ hardMs: 1000 });
    expect(timeouts.hardMs).toBe(1000);
    expect(timeouts.inactivityMs).toBe(1000);
  });

  it("honors an explicit inactivity override", () => {
    // An operator who verified --stream-partial-output delivers to a pipe
    // may restore a real watchdog deliberately.
    const timeouts = resolveCursorTimeouts({ hardMs: 5000, inactivityMs: 250 });
    expect(timeouts.inactivityMs).toBe(250);
  });

  it("keeps the shared kill-grace default", () => {
    const timeouts = resolveCursorTimeouts(undefined);
    expect(timeouts.killGraceMs).toBeGreaterThan(0);
  });
});
