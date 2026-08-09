import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod/v4";
import type { Result } from "types";
import {
  configError,
  GeneratorError,
  GeneratorErrorKind,
  type ConfigError,
} from "../contract/errors";
import {
  runWithSchemaFloor,
  schemaFeedbackMessage,
} from "../validation/enforceSchema";
import type { GenerateRequest, Generator, Logger } from "../contract/generator";
import { harnessTimeoutError } from "../harness/redact";
import {
  resolveHarnessTimeouts,
  runHarnessProcess,
  type HarnessRunResult,
  type HarnessTimeoutOverrides,
  type HarnessTimeouts,
} from "../harness/run";
import { enumPreservingJsonSchema } from "../validation/jsonSchema";
import type { Effort, Generation } from "../contract/generation";

/**
 * Claude Code CLI adapter (ADR 0030): one `claude -p` process per attempt,
 * stream-json envelopes on stdout, prompt via stdin.
 *
 * Invariants (audited against every path below):
 * 1. The schema floor is hard — the CLI's own `--json-schema` enforcement is
 *    a bonus layer; every terminal answer still runs `runWithSchemaFloor`
 *    (validate → salvage → one feedback retry → dump + throw).
 * 2. Abort rejections propagate UNTOUCHED (ADR 0006 #6) — the harness
 *    rejects with the signal's reason and nothing here wraps it.
 * 3. Origin is honest: `effort: null` (headless claude has no effort
 *    knob — ADR 0010's triage loses that lever here); the model stamp is
 *    the declaration, and the envelope's `modelUsage` keys are compared
 *    post-run — a served-model mismatch logs a warning and fires the
 *    surfacing hook, never silently rewrites the stamp (ADR 0013 #5).
 * 4. No secrets in errors: messages carry subtypes/categories/exit codes;
 *    stderr reaches messages only through `harnessTimeoutError` (redacted).
 * 5. Effort-independent lockdown profile: `--tools ""` (pure generation, no
 *    built-in tools), NO `--bare` (OAuth/keychain auth is the point of this
 *    adapter; `--bare` reads only API-key auth). System prompt goes via
 *    `--system-prompt-file` (argv would re-expose ARG_MAX for long
 *    taxonomies); the user prompt via stdin.
 */

/** In-band `system/api_retry` categories → taxonomy kinds (ADR 0030 #5). */
const API_RETRY_KIND: Record<string, GeneratorErrorKind> = {
  authentication_failed: GeneratorErrorKind.AUTH,
  oauth_org_not_allowed: GeneratorErrorKind.AUTH,
  billing_error: GeneratorErrorKind.AUTH,
  rate_limit: GeneratorErrorKind.PROVIDER_TRANSIENT,
  overloaded: GeneratorErrorKind.PROVIDER_TRANSIENT,
  server_error: GeneratorErrorKind.PROVIDER_TRANSIENT,
  invalid_request: GeneratorErrorKind.CONFIG,
  model_not_found: GeneratorErrorKind.CONFIG,
  max_output_tokens: GeneratorErrorKind.CONFIG,
};

/**
 * Documented result subtypes (capabilities note §1). Error messages render
 * subtype/category strings ONLY through these allowlists — envelope fields
 * are untrusted CLI output and must never carry arbitrary text into errors.
 */
const KNOWN_RESULT_SUBTYPES = new Set([
  "success",
  "error_max_turns",
  "error_during_execution",
  "error_max_structured_output_retries",
]);

function renderSubtype(subtype: string): string {
  return KNOWN_RESULT_SUBTYPES.has(subtype) ? subtype : "an unrecognized error";
}

/**
 * Own-property lookup only: the category is untrusted CLI output, and a
 * plain `in`/index read would resolve inherited Object members ("constructor",
 * "toString") — the kind must never become a function.
 */
function apiRetryKind(category: string): GeneratorErrorKind | undefined {
  return Object.hasOwn(API_RETRY_KIND, category)
    ? API_RETRY_KIND[category]
    : undefined;
}

function renderCategory(category: string): string {
  return Object.hasOwn(API_RETRY_KIND, category) || category === "unknown"
    ? category
    : "an unrecognized error category";
}

/** Same default as the SDK adapter — the stamp must name a real model. */
const DEFAULT_MODEL = "claude-opus-4-8";

export interface ClaudeCodeGeneratorOptions {
  /** Binary path or name (PATH-resolved by spawn). */
  command: string;
  model?: string | undefined;
  failureDir: string;
  timeouts?: HarnessTimeoutOverrides | undefined;
  /** Spawn env; defaults to process.env (the CLI needs HOME/keychain). */
  env?: Record<string, string | undefined> | undefined;
  /**
   * Served-model mismatch surfacing hook (trust-but-verify): fired when the
   * result envelope's `modelUsage` keys don't include the requested model.
   * The origin stamp stays the declaration either way.
   */
  onModelMismatch?: ((requested: string, served: string[]) => void) | undefined;
}

/** The stream-json events the adapter reads. Everything else is ignored. */
interface ResultEnvelope {
  subtype: string;
  isError: boolean;
  result: string;
  /**
   * Presence tracked separately from value: `structured_output: null` is a
   * schema-valid answer for null-accepting schemas, distinct from the field
   * being absent (raw-result fallback).
   */
  hasStructuredOutput: boolean;
  structuredOutput: unknown;
  modelUsage: string[] | null;
}

export class ClaudeCodeGenerator implements Generator {
  private readonly command: string;
  private readonly model: string;
  private readonly failureDir: string;
  private readonly timeouts: HarnessTimeouts;
  private readonly onModelMismatch:
    | ((requested: string, served: string[]) => void)
    | undefined;
  private readonly env: Record<string, string | undefined> | undefined;

  constructor(options: ClaudeCodeGeneratorOptions) {
    this.command = options.command;
    this.model = options.model ?? DEFAULT_MODEL;
    this.failureDir = options.failureDir;
    this.timeouts = resolveHarnessTimeouts(options.timeouts);
    this.onModelMismatch = options.onModelMismatch;
    this.env = options.env;
  }

  origin(effort: Effort): Generation {
    // Honest capability gap: no headless effort knob — the requested effort
    // is deliberately NOT echoed into the stamp (ADR 0013 #5).
    void effort;
    return { provider: "claude-code", model: this.model, effort: null };
  }

  async generate<S extends z.ZodType>(
    req: GenerateRequest<S>,
  ): Promise<z.infer<S>> {
    const log = req.log ?? (() => {});

    let wireSchema: Record<string, unknown>;
    try {
      wireSchema = enumPreservingJsonSchema(req.schema);
    } catch (error) {
      throw new GeneratorError(
        GeneratorErrorKind.CONFIG,
        `schema for ${req.label} is not representable as a strict JSON schema: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
        { cause: error },
      );
    }

    // The system prompt travels by file (argv would re-expose ARG_MAX);
    // one directory per generate() covers both attempts, cleaned in finally.
    const workDir = mkdtempSync(join(tmpdir(), "claude-code-gen-"));
    const systemFile = join(workDir, "system-prompt.txt");

    try {
      writeFileSync(systemFile, req.system, { mode: 0o600 });
      return await runWithSchemaFloor({
        schema: req.schema,
        label: req.label,
        ...(req.salvageFields ? { salvageFields: req.salvageFields } : {}),
        failureDir: this.failureDir,
        log,
        attempt: async (feedback) => {
          // Stateless CLI: the feedback retry is a fresh process whose
          // prompt stitches the failed output + validation errors after the
          // original user turn (the CLI has no assistant-turn boundary).
          const prompt = feedback
            ? `${req.user}\n\n[Your previous response]\n${feedback.raw}\n\n${schemaFeedbackMessage(feedback.error)}`
            : req.user;
          log(
            `${feedback ? "retrying" : "generating"} ${req.label} via ${this.command}…`,
          );
          const run = await runHarnessProcess({
            command: this.command,
            argv: [
              "-p",
              "--output-format",
              "stream-json",
              "--verbose",
              "--tools",
              "",
              "--model",
              this.model,
              "--system-prompt-file",
              systemFile,
              "--json-schema",
              JSON.stringify(wireSchema),
            ],
            stdin: prompt,
            timeouts: this.timeouts,
            ...(this.env ? { env: this.env } : {}),
            ...(req.signal ? { signal: req.signal } : {}),
            log,
          });
          return this.interpret(req.label, run, log);
        },
      });
    } finally {
      // Best-effort: a throw here would REPLACE the in-flight rejection
      // (JS finally semantics) — an abort or classified failure must never
      // be clobbered by a temp-dir I/O error.
      try {
        rmSync(workDir, { recursive: true, force: true });
      } catch {
        log(`note: could not remove temp dir ${workDir}`);
      }
    }
  }

  /** Map one finished CLI run onto a floor attempt or a classified throw. */
  private interpret(
    label: string,
    run: HarnessRunResult,
    log: Logger,
  ): { raw: string; parsed?: unknown; invalidReason?: string } {
    if (run.timedOut) {
      throw harnessTimeoutError(label, run);
    }

    let envelope: ResultEnvelope | null = null;
    let lastApiRetryCategory: string | null = null;
    for (const line of run.stdout.split("\n")) {
      const event = parseEventLine(line);
      if (event === null) continue;
      if (event.type === "system" && event.subtype === "api_retry") {
        lastApiRetryCategory = event.errorCategory;
      } else if (event.type === "result") {
        envelope = event.envelope;
      }
    }

    if (envelope === null) {
      // Exit without a result envelope: classify from the in-band retry
      // category when one was seen (auth expiry, rate limits), else opaque.
      const kind =
        (lastApiRetryCategory !== null
          ? apiRetryKind(lastApiRetryCategory)
          : undefined) ?? GeneratorErrorKind.OPAQUE;
      throw new GeneratorError(
        kind,
        `${this.command} exited (code ${run.exitCode ?? `signal ${run.exitSignal ?? "unknown"}`}) without a result envelope for ${label}${
          lastApiRetryCategory !== null
            ? ` after ${renderCategory(lastApiRetryCategory)}`
            : ""
        }`,
      );
    }

    this.verifyServedModel(envelope, log);

    if (envelope.subtype === "error_max_structured_output_retries") {
      // The CLI exhausted its own enforcement retries — but our floor is
      // stricter AND more forgiving in different places (salvage): hand the
      // raw text over for normal parse/salvage/retry rather than declaring
      // it invalid here. invalidReason only when there is nothing to parse.
      if (envelope.result === "") {
        return {
          raw: "",
          invalidReason: `claude-code exhausted its structured-output retries for ${label} with no output`,
        };
      }
      return { raw: envelope.result };
    }
    if (envelope.isError) {
      throw new GeneratorError(
        GeneratorErrorKind.OPAQUE,
        `${this.command} reported ${envelope.subtype === "" ? "an error" : renderSubtype(envelope.subtype)} for ${label}`,
      );
    }
    if (envelope.hasStructuredOutput) {
      // Parsed candidate + raw fallback: the floor validates the candidate
      // first and falls back to the raw text if it was reshaped in flight.
      // An explicit null candidate rides through — it is schema-valid for
      // null-accepting schemas and the floor is the judge, not this boundary.
      return { raw: envelope.result, parsed: envelope.structuredOutput };
    }
    if (envelope.result === "") {
      return {
        raw: "",
        invalidReason: `No output for ${label} (subtype=${renderSubtype(envelope.subtype)})`,
      };
    }
    return { raw: envelope.result };
  }

  /** Trust-but-verify: envelope modelUsage keys vs the requested model. */
  private verifyServedModel(envelope: ResultEnvelope, log: Logger): void {
    if (envelope.modelUsage === null) {
      // Missing/drifted modelUsage: verification is UNAVAILABLE, which must
      // surface (ADR 0013 #5) rather than silently pass — served [] means
      // "could not verify", distinct from a concrete mismatch.
      log(
        `warning: result envelope carried no modelUsage — served model for ${this.model} is unverifiable`,
      );
      this.onModelMismatch?.(this.model, []);
      return;
    }
    if (envelope.modelUsage.includes(this.model)) return;
    log(
      `warning: requested model ${this.model} but modelUsage reports ${envelope.modelUsage.join(", ")} — origin stamp stays the declaration`,
    );
    this.onModelMismatch?.(this.model, envelope.modelUsage);
  }
}

/** One parsed stream-json line, narrowed to the events the adapter reads. */
type StreamEvent =
  | { type: "system"; subtype: string; errorCategory: string | null }
  | { type: "result"; envelope: ResultEnvelope };

function parseEventLine(line: string): StreamEvent | null {
  if (line.trim() === "") return null;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null; // Non-JSON noise on stdout is not ours to interpret.
  }
  if (typeof value !== "object" || value === null) return null;
  const type = Reflect.get(value, "type");
  if (type === "system") {
    const subtype = Reflect.get(value, "subtype");
    const error = Reflect.get(value, "error");
    return {
      type: "system",
      subtype: typeof subtype === "string" ? subtype : "",
      errorCategory: typeof error === "string" ? error : null,
    };
  }
  if (type === "result") {
    const subtype = Reflect.get(value, "subtype");
    const isError = Reflect.get(value, "is_error");
    const result = Reflect.get(value, "result");
    const modelUsage = Reflect.get(value, "modelUsage");
    return {
      type: "result",
      envelope: {
        subtype: typeof subtype === "string" ? subtype : "",
        isError: isError === true,
        result: typeof result === "string" ? result : "",
        hasStructuredOutput: Reflect.has(value, "structured_output"),
        structuredOutput: Reflect.get(value, "structured_output"),
        modelUsage:
          typeof modelUsage === "object" && modelUsage !== null
            ? Object.keys(modelUsage)
            : null,
      },
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Boot-probe billing checks (BRIEF-150, decisions locked on the BRIEF-141
// wayfinder map): a version-floor warning and a billing-route assertion,
// both reading stdout the probe already produces. The route assertion is
// what closes the `apiKeyHelper` residual hole (run.ts BRIEF-140 note) at
// verification time — a settings-file override is invisible to the env
// strip, but `auth status --json` reports it as the active auth method.
// ---------------------------------------------------------------------------

/** Boot-probe wiring shared with the registry entry (CODEX_PROBE pattern). */
export const CLAUDE_PROBE = {
  versionArgv: ["--version"],
  /** `--json` is the default output format of `auth status`. */
  authArgv: ["auth", "status"],
  authFailureHint:
    "run `claude /login` interactively on this machine (or set CLAUDE_CODE_OAUTH_TOKEN; an ANTHROPIC_API_KEY cannot authenticate this provider — the harness strips it)",
} as const;

/**
 * Oldest CLI verified to bill subscription OAuth spend to the subscription
 * (BRIEF-141, verified 2026-08-08): older versions misattributed it to the
 * Console prepaid account.
 */
export const CLAUDE_BILLING_VERSION_FLOOR = "2.1.226";

const VERSION_SHAPE = /(\d+)\.(\d+)\.(\d+)/;

function parseCliVersion(text: string): [number, number, number] | null {
  const match = VERSION_SHAPE.exec(text);
  if (match === null) return null;
  const [, major, minor, patch] = match;
  return [Number(major), Number(minor), Number(patch)];
}

/**
 * Version-floor check, warn-only (ticket decision 1: non-fatal — the floor
 * is about billing attribution, not ability to run). Unparseable output
 * warns too: "could not verify" must surface, never silently pass.
 */
export function claudeVersionWarning(stdout: string): string | null {
  const seen = parseCliVersion(stdout);
  if (seen === null) {
    return `warning: could not read a version from the claude CLI's --version output — the billing-attribution floor ${CLAUDE_BILLING_VERSION_FLOOR} is unverifiable (BRIEF-141)`;
  }
  const floor = parseCliVersion(CLAUDE_BILLING_VERSION_FLOOR);
  if (floor === null) return null; // unreachable: the floor constant parses
  for (let i = 0; i < 3; i++) {
    const a = seen[i] ?? 0;
    const b = floor[i] ?? 0;
    if (a > b) return null;
    if (a < b) {
      // Rendered digits come from the parse, never raw stdout.
      return `warning: claude CLI ${seen.join(".")} is older than ${CLAUDE_BILLING_VERSION_FLOOR}, the oldest version verified to bill subscription OAuth runs to the subscription — older versions charged the Console API account instead (BRIEF-141); upgrade the CLI`;
    }
  }
  return null;
}

/**
 * The `auth status --json` fields the assertion reads (lenient shape —
 * unknown fields ignored, missing fields degrade to "unverifiable").
 * Route table verified at CLI 2.1.226 (docs/plans/brief-150 plan):
 * keychain login = `claude.ai`, CLAUDE_CODE_OAUTH_TOKEN = `oauth_token`
 * (both subscription); `api_key_helper` and any `apiKeySource` = API key.
 */
const authStatusShape = z.object({
  // Per-field `catch`: one drifted field (e.g. `authMethod: null` — the CLI
  // does emit null for absent-ish fields) must not collapse the whole parse
  // and drop positive API-key evidence in the OTHER field to "unverifiable".
  authMethod: z.string().nullish().catch(undefined),
  apiKeySource: z.string().nullish().catch(undefined),
});

const SUBSCRIPTION_AUTH_METHODS = new Set(["claude.ai", "oauth_token"]);

/** Allowlisted rendering of untrusted route fields (no-secrets invariant). */
const KNOWN_API_KEY_SOURCES = new Set(["ANTHROPIC_API_KEY", "apiKeyHelper"]);
const KNOWN_REFUSED_METHODS = new Set(["api_key_helper"]);

const UNVERIFIABLE_WARNING =
  "warning: could not read the billing route from `claude auth status` — subscription billing is unverifiable (CLI older than the auth-status JSON surface?); upgrade the CLI to restore the boot-time assertion (BRIEF-141)";

function refuseBillingRoute(detail: string): ReturnType<typeof configError> {
  return configError([
    `claude CLI billing route is ${detail}, not the subscription login — refusing to start rather than bill an API account (BRIEF-141). Remove any apiKeyHelper entry from the CLI's settings.json, unset API key env vars, then verify with \`claude auth status\``,
  ]);
}

/**
 * Billing-route assertion (ticket decision 2, refuse on mismatch).
 * Positive-evidence refusals only: output that doesn't carry the fields
 * warns "unverifiable" instead of refusing — refusing on a parse gap would
 * brick every pre-floor CLI and make decision 1's non-fatal version
 * warning unreachable.
 */
export function interpretClaudeAuthStatus(
  stdout: string,
): Result<string | null, ConfigError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { ok: true, value: UNVERIFIABLE_WARNING };
  }
  const status = authStatusShape.safeParse(parsed);
  if (!status.success) return { ok: true, value: UNVERIFIABLE_WARNING };
  // null and undefined both mean "route field not usable" downstream.
  const authMethod = status.data.authMethod ?? undefined;
  const apiKeySource = status.data.apiKeySource ?? undefined;

  if (typeof apiKeySource === "string" && apiKeySource.length > 0) {
    const source = KNOWN_API_KEY_SOURCES.has(apiKeySource)
      ? apiKeySource
      : "an unrecognized source";
    return refuseBillingRoute(`an API key (via ${source})`);
  }
  if (authMethod === undefined) {
    // Parsed JSON without the route field: unverifiable, same as no JSON.
    return { ok: true, value: UNVERIFIABLE_WARNING };
  }
  if (!SUBSCRIPTION_AUTH_METHODS.has(authMethod)) {
    const method = KNOWN_REFUSED_METHODS.has(authMethod)
      ? `\`${authMethod}\``
      : "an unrecognized auth method";
    return refuseBillingRoute(method);
  }
  return { ok: true, value: null };
}
