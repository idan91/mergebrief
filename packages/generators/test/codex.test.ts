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
import { CodexGenerator } from "../src/adapters/codex";
import { GeneratorError, GeneratorErrorKinds } from "../src/contract/errors";
import type { GenerateRequest } from "../src/contract/generator";
import { createGenerator, Providers } from "../src/config/registry";
import { expectEmptyRemovedCwds, stubShimCommand } from "./helpers";

/**
 * Use real fake-codex processes for argv, tempfile, envelope and origin behavior.
 * Keep shared pipeline conformance in codex.contract.test.ts.
 */

const FAKE_CODEX = join(
  dirname(fileURLToPath(import.meta.url)),
  "shims",
  "fake-codex.cjs",
);

const Schema = z.object({ ok: z.boolean() });

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
  overrides?: Partial<ConstructorParameters<typeof CodexGenerator>[0]>,
) {
  const shim = stubShimCommand(FAKE_CODEX, { ...process.env, ...env });
  return new CodexGenerator({
    command: shim.command,
    failureDir: tempDir("codex-fail-"),
    env: shim.env,
    timeouts: { hardMs: 8000, inactivityMs: 4000, killGraceMs: 300 },
    ...overrides,
  });
}

function request(log?: (m: string) => void): GenerateRequest<typeof Schema> {
  const req: GenerateRequest<typeof Schema> = {
    schema: Schema,
    system: "you are a test",
    user: "produce ok",
    effort: "high",
    label: "probe",
  };

  if (log) {
    req.log = log;
  }

  return req;
}

function makeCwdLoggedGenerator(turns: unknown[]) {
  const scriptDir = tempDir("codex-cwd-");
  writeFileSync(join(scriptDir, "turns.json"), JSON.stringify(turns));
  const cwdLog = join(scriptDir, "cwd.log");
  const generator = makeGenerator({
    SHIM_SCENARIO: "scripted",
    SHIM_SCRIPT_DIR: scriptDir,
    SHIM_CWD_LOG: cwdLog,
  });
  return { generator, cwdLog };
}

describe("CodexGenerator spawn cwd", () => {
  it("runs the CLI in an empty temp cwd, removed after success", async () => {
    const { generator, cwdLog } = makeCwdLoggedGenerator([
      { output: '{"ok":true}' },
    ]);
    await expect(generator.generate(request())).resolves.toEqual({ ok: true });

    expectEmptyRemovedCwds(cwdLog, "codex-gen-");
  });

  it("removes the empty temp cwd after a failed generation", async () => {
    const { generator, cwdLog } = makeCwdLoggedGenerator([{ fatal: "boom" }]);
    await expect(generator.generate(request())).rejects.toMatchObject({
      kind: GeneratorErrorKinds.OPAQUE,
    });

    expectEmptyRemovedCwds(cwdLog, "codex-gen-");
  });
});

describe("CodexGenerator invocation profile", () => {
  it("passes the lockdown argv, prompt via stdin, schema via tempfile", async () => {
    const scriptDir = tempDir("codex-argv-");
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
    // The COMPLETE lockdown argv contract: tools off, a read-only offline
    // permission profile, no session persistence, effort mapped to
    // model_reasoning_effort, no --model when unconfigured.
    const disabledFeatures = [
      "shell_tool",
      "hooks",
      "browser_use",
      "browser_use_external",
      "browser_use_full_cdp_access",
      "computer_use",
      "multi_agent",
      "plugins",
      "remote_plugin",
      "apps",
      "image_generation",
      "view_image",
    ].flatMap((feature) => ["-c", `features.${feature}=false`]);
    expect(argv).toEqual([
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--output-schema",
      expect.stringContaining("codex-gen-"),
      ...disabledFeatures,
      "-c",
      'web_search="disabled"',
      "-c",
      "analytics.enabled=false",
      "-c",
      "check_for_update_on_startup=false",
      "-c",
      "approval_policy=never",
      "-c",
      expect.stringMatching(
        /^permissions\.mergebrief\.filesystem=\{":minimal"="read", ":workspace_roots"=\{"\."="read"\}, "\/.+\/packages"="read", "\/.+\/\.local\/bin"="read"\}$/,
      ),
      "-c",
      "default_permissions=mergebrief",
      "-c",
      "model_reasoning_effort=high",
    ]);
    if (!Array.isArray(argv)) {
      throw new Error("expected recorded argv array");
    }
    expect(argv.join(" ")).not.toContain("produce ok");
    // Prompt (system + user stitched) went via stdin; the schema tempfile
    // carried the enum-preserving schema (captured before cleanup).
    const stdin = readFileSync(join(scriptDir, "stdin-0.txt"), "utf8");
    expect(stdin).toContain("you are a test");
    expect(stdin).toContain("produce ok");
    const schema: unknown = JSON.parse(
      readFileSync(join(scriptDir, "schema-0.json"), "utf8"),
    );
    expect(JSON.stringify(schema)).toContain('"ok"');
    // 0600 while the CLI ran; removed once generate() settled.
    const meta: unknown = JSON.parse(
      readFileSync(join(scriptDir, "schema-meta-0.json"), "utf8"),
    );
    expect(meta).toMatchObject({ mode: 0o600 });
    if (typeof meta !== "object" || meta === null) {
      throw new Error("bad meta");
    }
    expect(existsSync(String(Reflect.get(meta, "path")))).toBe(false);
  });

  it("sends strict all-required null unions and removes stand-in nulls", async () => {
    const scriptDir = tempDir("codex-optional-");
    writeFileSync(
      join(scriptDir, "turns.json"),
      // A compliant model fills the formerly-optional slot with the
      // null-union stand-in; the adapter must strip it before the floor.
      JSON.stringify([{ output: '{"ok":true,"note":null}' }]),
    );
    const generator = makeGenerator({
      SHIM_SCENARIO: "scripted",
      SHIM_SCRIPT_DIR: scriptDir,
    });
    const withOptional = z.object({
      ok: z.boolean(),
      note: z.string().optional(),
    });
    await expect(
      generator.generate({ ...request(), schema: withOptional }),
    ).resolves.toEqual({ ok: true });

    // The wire schema lists EVERY property as required (the OpenAI-lineage
    // strict rule the codex CLI forwards to), with the optional property
    // widened to a null-union.
    const schema: unknown = JSON.parse(
      readFileSync(join(scriptDir, "schema-0.json"), "utf8"),
    );
    if (typeof schema !== "object" || schema === null) {
      throw new Error("bad schema");
    }
    expect(Reflect.get(schema, "required")).toEqual(["ok", "note"]);
    expect(Reflect.get(schema, "properties")).toMatchObject({
      note: { anyOf: [{ type: "string" }, { type: "null" }] },
    });
  });

  it("removes the schema tempfile after a rejected run too", async () => {
    const scriptDir = tempDir("codex-cleanup-");
    writeFileSync(
      join(scriptDir, "turns.json"),
      JSON.stringify([{ turnFailed: "boom" }]),
    );
    const generator = makeGenerator({
      SHIM_SCENARIO: "scripted",
      SHIM_SCRIPT_DIR: scriptDir,
    });
    await expect(generator.generate(request())).rejects.toBeInstanceOf(
      GeneratorError,
    );
    const meta: unknown = JSON.parse(
      readFileSync(join(scriptDir, "schema-meta-0.json"), "utf8"),
    );
    if (typeof meta !== "object" || meta === null) {
      throw new Error("bad meta");
    }
    expect(existsSync(String(Reflect.get(meta, "path")))).toBe(false);
  });

  it("passes --model when configured and stamps it in the origin", async () => {
    const scriptDir = tempDir("codex-model-");
    writeFileSync(
      join(scriptDir, "turns.json"),
      JSON.stringify([{ output: '{"ok":true}' }]),
    );
    const generator = makeGenerator(
      { SHIM_SCENARIO: "scripted", SHIM_SCRIPT_DIR: scriptDir },
      { model: "gpt-5.6-sol" },
    );
    await expect(generator.generate(request())).resolves.toEqual({ ok: true });
    const argv: unknown = JSON.parse(
      readFileSync(join(scriptDir, "argv-0.json"), "utf8"),
    );
    if (!Array.isArray(argv)) {
      throw new Error("expected argv array");
    }
    expect(argv.slice(-2)).toEqual(["--model", "gpt-5.6-sol"]);
    expect(generator.origin("low")).toEqual({
      provider: "codex",
      model: "gpt-5.6-sol",
      effort: "low",
    });
  });
});

describe("CodexGenerator spawn env", () => {
  it("passes CODEX_HOME, never a host secret", async () => {
    const EchoSchema = z.object({ envNames: z.array(z.string()) });
    const generator = makeGenerator({
      SHIM_SCENARIO: "env-echo",
      CODEX_HOME: "/codex-home",
      CODEX_API_KEY: "shim-codex-key",
      DATABASE_URL: "postgres://app:pw@db/app",
    });
    const echoed = await generator.generate({
      schema: EchoSchema,
      system: "s",
      user: "u",
      effort: "medium",
      label: "env",
    });
    expect(echoed.envNames).toContain("CODEX_HOME");
    expect(echoed.envNames).not.toContain("CODEX_API_KEY");
    expect(echoed.envNames).not.toContain("DATABASE_URL");
  });
});

describe("CodexGenerator answer selection and classification", () => {
  it("keeps untrusted failure messages out of the thrown error", async () => {
    const generator = makeGenerator({ SHIM_SCENARIO: "turn-failed" });
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
    // The shim's message is "stream error: rate limited", free-form CLI
    // text must never reach the error message.
    expect(caught.message).not.toContain("rate limited");
    expect(caught.message).toContain("in-band error event");
  });

  it("classifies a fatal error event as opaque without echoing its message", async () => {
    const generator = makeGenerator({
      SHIM_SCENARIO: "fatal-error",
      SHIM_ERROR: "leak-SENTINEL-token",
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
  });

  it("preserves earlier answers when agent_message text is not a string", async () => {
    // Envelope drift: a valid answer followed by a non-string text item,
    // the drifted item must not overwrite the answer with "".
    const scriptDir = tempDir("codex-nonstring-");
    writeFileSync(
      join(scriptDir, "turns.json"),
      JSON.stringify([{ output: '{"ok":true}', trailingNonString: true }]),
    );
    const generator = makeGenerator({
      SHIM_SCENARIO: "scripted",
      SHIM_SCRIPT_DIR: scriptDir,
    });
    await expect(generator.generate(request())).resolves.toEqual({ ok: true });
  });

  it("voids answers paired with fatal events even on exit zero", async () => {
    const scriptDir = tempDir("codex-fatalanswer-");
    writeFileSync(
      join(scriptDir, "turns.json"),
      JSON.stringify([
        { output: '{"ok":true}', fatalBeforeAnswerExitZero: true },
      ]),
    );
    const generator = makeGenerator({
      SHIM_SCENARIO: "scripted",
      SHIM_SCRIPT_DIR: scriptDir,
    });
    await expect(generator.generate(request())).rejects.toMatchObject({
      kind: GeneratorErrorKinds.OPAQUE,
    });
  });

  it("classifies a clean exit without an agent answer as opaque", async () => {
    const generator = makeGenerator({ SHIM_SCENARIO: "envelope-drift" });
    await expect(generator.generate(request())).rejects.toMatchObject({
      kind: GeneratorErrorKinds.OPAQUE,
    });
  });

  it("classifies a silent hang as a timeout", async () => {
    const generator = makeGenerator(
      { SHIM_SCENARIO: "hang" },
      { timeouts: { hardMs: 8000, inactivityMs: 100, killGraceMs: 200 } },
    );
    await expect(generator.generate(request())).rejects.toMatchObject({
      kind: GeneratorErrorKinds.TIMEOUT,
    });
  });

  it("passes non-JSON answers to the schema floor for parsing", async () => {
    const scriptDir = tempDir("codex-nonjson-");
    writeFileSync(
      join(scriptDir, "turns.json"),
      JSON.stringify([
        { output: "I could not produce JSON, sorry." },
        { output: '{"ok":true}' },
      ]),
    );
    const generator = makeGenerator({
      SHIM_SCENARIO: "scripted",
      SHIM_SCRIPT_DIR: scriptDir,
    });
    // Floor retry recovers on the second scripted turn.
    await expect(generator.generate(request())).resolves.toEqual({ ok: true });
    expect(readFileSync(join(scriptDir, "counter"), "utf8")).toBe("2");
  });
});

function makeDeps(env: Record<string, string>) {
  const shim = stubShimCommand(FAKE_CODEX, { ...process.env, ...env });
  return {
    command: shim.command,
    env: shim.env,
    failureDir: tempDir("codex-reg-"),
  };
}

describe("codex registry entry", () => {
  it("constructs through the boot probe against the shim", async () => {
    const deps = makeDeps({ SHIM_SCENARIO: "valid" });
    const result = await createGenerator(
      { provider: Providers.CODEX, command: deps.command },
      deps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.origin("high")).toEqual({
      provider: "codex",
      model: "codex-default",
      effort: "high",
    });
  });

  it("refuses boot when the CLI is not logged in", async () => {
    const deps = makeDeps({ SHIM_SCENARIO: "auth-error" });
    const result = await createGenerator(
      { provider: Providers.CODEX, command: deps.command },
      deps,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues.join("; ")).toContain("codex login");
  });

  it("refuses a CLI older than the version the hardening was checked on", async () => {
    const deps = makeDeps({ SHIM_SCENARIO: "valid", SHIM_VERSION: "0.150.0" });
    const result = await createGenerator(
      { provider: Providers.CODEX, command: deps.command },
      deps,
    );
    expect(result.ok).toBe(false);
    const issues = result.ok ? "" : result.error.issues.join("; ");
    expect(issues).toContain("0.150.0");
    expect(issues).toContain("0.163.0");
  });

  it("refuses a stored API-key login that would bill an API account", async () => {
    const deps = makeDeps({
      SHIM_SCENARIO: "valid",
      SHIM_LOGIN_STATUS: "Logged in using an API key - sk-proj-***",
    });
    const result = await createGenerator(
      { provider: Providers.CODEX, command: deps.command },
      deps,
    );
    expect(result.ok).toBe(false);
    const issues = result.ok ? "" : result.error.issues.join("; ");
    expect(issues).toContain("API key");
    expect(issues).not.toContain("sk-proj");
  });

  it("warns but constructs when the login route is unreadable", async () => {
    const warnings: string[] = [];
    const deps = makeDeps({
      SHIM_SCENARIO: "valid",
      SHIM_LOGIN_STATUS: "Signed in",
    });
    const result = await createGenerator(
      { provider: Providers.CODEX, command: deps.command },
      { ...deps, log: (m) => warnings.push(m) },
    );
    expect(result.ok).toBe(true);
    expect(warnings.join("; ")).toContain("unverifiable");
  });
});
