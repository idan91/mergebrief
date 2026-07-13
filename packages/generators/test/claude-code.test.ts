import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { ClaudeCodeGenerator } from "../src/claudeCode";
import { GeneratorError, GeneratorErrorKind } from "../src/errors";
import { createGenerator, Providers } from "../src/registry";

/**
 * Adapter-specific behavior on real fake-claude processes: invocation
 * profile (argv), envelope classification, trust-but-verify modelUsage,
 * and registry construction (boot probe). The pipeline conformance cases
 * live in claude-code.contract.test.ts.
 */

const FAKE_CLAUDE = join(
  dirname(fileURLToPath(import.meta.url)),
  "shims",
  "fake-claude.cjs",
);

const Schema = z.object({ ok: z.boolean() });

// Every temp dir is tracked and removed after each test — repeated local
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
  return new ClaudeCodeGenerator({
    command: FAKE_CLAUDE,
    failureDir: tempDir("claude-code-fail-"),
    env: { ...process.env, ...env },
    timeouts: { hardMs: 8000, inactivityMs: 4000, killGraceMs: 300 },
    ...overrides,
  });
}

function request(log?: (m: string) => void) {
  return {
    schema: Schema,
    system: "you are a test",
    user: "produce ok",
    effort: "medium" as const,
    label: "probe",
    ...(log ? { log } : {}),
  };
}

describe("ClaudeCodeGenerator invocation profile", () => {
  it("passes the lockdown argv and delivers prompts via stdin, system via file", async () => {
    const scriptDir = tempDir("claude-code-argv-");
    const { writeFileSync } = await import("node:fs");
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
    // The COMPLETE lockdown argv contract — order, pairing, and nothing
    // extra (a missing --verbose or a non-empty --tools must fail here).
    // NEVER --bare: OAuth/keychain auth is the point of this adapter.
    expect(argv).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
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
    if (!Array.isArray(argv)) throw new Error("expected recorded argv array");
    expect(argv.join(" ")).not.toContain("produce ok");
    const stdin = readFileSync(join(scriptDir, "stdin-0.txt"), "utf8");
    expect(stdin).toBe("produce ok");
    const system = readFileSync(join(scriptDir, "system-0.txt"), "utf8");
    expect(system).toBe("you are a test");
  });

  it("declares effort-less provenance regardless of requested effort", () => {
    const generator = makeGenerator({});
    expect(generator.provenance("high")).toEqual({
      provider: "claude-code",
      model: "claude-opus-4-8",
      effort: null,
    });
  });
});

describe("ClaudeCodeGenerator envelope classification", () => {
  it("maps an api_retry auth category to kind auth when the run dies", async () => {
    const generator = makeGenerator({ SHIM_SCENARIO: "api-retry-auth" });
    const promise = generator.generate(request());
    await expect(promise).rejects.toBeInstanceOf(GeneratorError);
    await expect(promise).rejects.toMatchObject({
      kind: GeneratorErrorKind.AUTH,
    });
    await expect(promise).rejects.toThrow(/authentication_failed/);
  });

  it("classifies an exit without a result envelope as opaque", async () => {
    const generator = makeGenerator({ SHIM_SCENARIO: "envelope-drift" });
    await expect(generator.generate(request())).rejects.toMatchObject({
      kind: GeneratorErrorKind.OPAQUE,
    });
  });

  it("classifies a silent hang as a timeout", async () => {
    const generator = makeGenerator(
      { SHIM_SCENARIO: "hang" },
      { timeouts: { hardMs: 8000, inactivityMs: 300, killGraceMs: 200 } },
    );
    const promise = generator.generate(request());
    await expect(promise).rejects.toMatchObject({
      kind: GeneratorErrorKind.TIMEOUT,
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
    const { writeFileSync } = await import("node:fs");
    // forceExhausted: the shim emits the CLI-rejected envelope even though
    // the payload is parseable JSON — the real CLI rejects on SCHEMA, and
    // an enum slip is exactly that shape.
    writeFileSync(
      join(scriptDir, "turns.json"),
      JSON.stringify([{ output: '{"title":"t","tags":["bugfix","scary"]}', forceExhausted: true }]),
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
    // A drifted CLI could put arbitrary text in subtype/category fields —
    // errors must render allowlisted tokens only, never the raw string.
    const scriptDir = tempDir("claude-code-sentinel-");
    const { writeFileSync } = await import("node:fs");
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
    if (!(caught instanceof GeneratorError)) throw new Error("wrong rejection");
    expect(caught.message).not.toContain("SENTINEL");
    expect(caught.message).toContain("an unrecognized error");
  });

  it("treats inherited-object category names as unrecognized, kind opaque", async () => {
    // "constructor" resolves on Object.prototype — a plain `in`/index read
    // would return a FUNCTION as the kind and allowlist the name.
    const scriptDir = tempDir("claude-code-proto-");
    const { writeFileSync } = await import("node:fs");
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
    if (!(caught instanceof GeneratorError)) throw new Error("wrong rejection");
    expect(caught.kind).toBe(GeneratorErrorKind.OPAQUE);
    expect(caught.message).not.toContain("after constructor");
    expect(caught.message).toContain("an unrecognized error category");
  });

  it("keeps a drifted subtype out of the empty-output invalidReason", async () => {
    const scriptDir = tempDir("claude-code-emptysub-");
    const { writeFileSync } = await import("node:fs");
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
    if (!(caught instanceof GeneratorError)) throw new Error("wrong rejection");
    // The schema floor surfaces invalidReason in its message chain — the
    // drifted subtype must have been rendered through the allowlist.
    expect(caught.message).not.toContain("SENTINEL");
  });

  it("feeds a CLI-exhausted structured-output failure to the schema floor", async () => {
    // subtype error_max_structured_output_retries with junk text: our floor
    // retries once (fresh process) and the second scripted turn recovers.
    const scriptDir = tempDir("claude-code-floor-");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      join(scriptDir, "turns.json"),
      JSON.stringify([{ output: "not json at all" }, { output: '{"ok":true}' }]),
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
      generator.generate(request((m) => logs.push(m))),
    ).resolves.toEqual({ ok: true });
    expect(mismatches).toEqual([
      { requested: "claude-opus-4-8", served: ["claude-haiku-4-5"] },
    ]);
    expect(logs.join("\n")).toContain("modelUsage reports claude-haiku-4-5");
    // The stamp stays the declaration (ADR 0013 #5).
    expect(generator.provenance("medium").model).toBe("claude-opus-4-8");
  });

  it("surfaces a missing modelUsage as unverifiable (empty served list)", async () => {
    const scriptDir = tempDir("claude-code-nousage-");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      join(scriptDir, "turns.json"),
      JSON.stringify([{ output: '{"ok":true}', noModelUsage: true }]),
    );
    const logs: string[] = [];
    const mismatches: string[][] = [];
    const generator = makeGenerator(
      { SHIM_SCENARIO: "scripted", SHIM_SCRIPT_DIR: scriptDir },
      { onModelMismatch: (_requested, served) => mismatches.push(served) },
    );
    await expect(
      generator.generate(request((m) => logs.push(m))),
    ).resolves.toEqual({ ok: true });
    expect(mismatches).toEqual([[]]);
    expect(logs.join("\n")).toContain("unverifiable");
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

function deps(env: Record<string, string>) {
  return {
    env: { ...process.env, ...env },
    failureDir: tempDir("claude-code-reg-"),
  };
}

describe("claude-code registry entry", () => {
  it("constructs through the boot probe against the shim", async () => {
    const result = await createGenerator(
      { provider: Providers.CLAUDE_CODE, command: FAKE_CLAUDE },
      deps({ SHIM_SCENARIO: "valid" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.provenance("low")).toMatchObject({
      provider: "claude-code",
    });
  });

  it("refuses boot when the CLI is not authenticated", async () => {
    const result = await createGenerator(
      { provider: Providers.CLAUDE_CODE, command: FAKE_CLAUDE },
      deps({ SHIM_SCENARIO: "auth-error" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues.join("; ")).toContain("not authenticated");
  });

  it("refuses boot when the binary is missing", async () => {
    const result = await createGenerator(
      { provider: Providers.CLAUDE_CODE, command: "/nonexistent/claude" },
      deps({}),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues.join("; ")).toContain("not found on PATH");
  });

  it("rejects unknown option keys strictly", async () => {
    const result = await createGenerator(
      { provider: Providers.CLAUDE_CODE, modle: "typo" },
      deps({}),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues.join("; ")).toContain('"modle"');
  });
});
