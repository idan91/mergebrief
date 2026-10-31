import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod/v4";
import type { Result } from "types/utils";
import {
  configError,
  GeneratorError,
  GeneratorErrorKinds,
  type ConfigError,
  type GeneratorErrorKind,
} from "../contract/errors";
import {
  runWithSchemaFloor,
  schemaFeedbackMessage,
  type FloorAttempt,
  type RunWithSchemaFloorArgs,
} from "../validation/enforceSchema";
import type {
  GenerateRequest,
  Generator,
  Logger,
  TokenUsage,
} from "../contract/generator";
import {
  GeneratorWarningKinds,
  type GeneratorWarningSink,
} from "../contract/types";
import { harnessTimeoutError } from "../harness/redact";
import {
  resolveHarnessTimeouts,
  runHarnessProcess,
  type HarnessRunArgs,
  type HarnessRunResult,
  type HarnessCliEnv,
  type HarnessTimeoutOverrides,
  type HarnessTimeouts,
} from "../harness/run";
import type { CliVersionPolicy } from "../harness/version-floor";
import {
  createHarnessWorkDir,
  removeHarnessWorkDir,
} from "../harness/work-dir";
import { enumPreservingJsonSchema } from "../validation/jsonSchema";
import type { Effort, Generation } from "../contract/generation";
import { joinUserText, readClaudeOutputCeiling } from "./utils";

// Do not use --bare: this adapter relies on OAuth/keychain subscription auth.
// The system prompt uses a file to avoid ARG_MAX; the user prompt uses stdin.

/** In-band `system/api_retry` categories → taxonomy kinds. */
const API_RETRY_KIND: Record<string, GeneratorErrorKind> = {
  authentication_failed: GeneratorErrorKinds.AUTH,
  oauth_org_not_allowed: GeneratorErrorKinds.AUTH,
  billing_error: GeneratorErrorKinds.AUTH,
  rate_limit: GeneratorErrorKinds.PROVIDER_TRANSIENT,
  overloaded: GeneratorErrorKinds.PROVIDER_TRANSIENT,
  server_error: GeneratorErrorKinds.PROVIDER_TRANSIENT,
  invalid_request: GeneratorErrorKinds.CONFIG,
  model_not_found: GeneratorErrorKinds.CONFIG,
  max_output_tokens: GeneratorErrorKinds.CONFIG,
};

/**
 * Documented result subtypes. Error messages render subtype/category
 * strings ONLY through these allowlists, envelope fields
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

// The CLI refuses an oversized prompt with `is_error: true` under `subtype: "success"`.
function renderErrorSubtype(subtype: string): string {
  if (subtype === "") {
    return "an error";
  }
  if (subtype === "success") {
    return "an error with subtype success";
  }
  return renderSubtype(subtype);
}

/**
 * Own-property lookup only: the category is untrusted CLI output, and a
 * plain `in`/index read would resolve inherited Object members ("constructor",
 * "toString"), the kind must never become a function.
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

/** Same default as the SDK adapter, the stamp must name a real model. */
const DEFAULT_MODEL = "claude-opus-4-8";
/** The CLI's own output cap, set only for a request that names one. */
const OUTPUT_CAP_VAR = "CLAUDE_CODE_MAX_OUTPUT_TOKENS";
const CUT_STOP_REASON = "max_tokens";

/**
 * `modelUsage` keys are untrusted CLI output: a key reaches a log line, a
 * warning or the mismatch hook only through this grammar, and only the
 * first few are listed.
 */
const MODEL_ID_GRAMMAR = /^[\w.:[\]-]{1,100}$/;
const MAX_LISTED_SERVED_MODELS = 3;
const UNRECOGNIZED_MODEL_ID = "(unrecognized id)";

function renderModelId(id: string): string {
  return MODEL_ID_GRAMMAR.test(id) ? id : UNRECOGNIZED_MODEL_ID;
}

function listServedModels(modelUsage: string[]): string[] {
  return modelUsage.slice(0, MAX_LISTED_SERVED_MODELS).map(renderModelId);
}

function describeServedModels(listed: string[], total: number): string {
  const unlisted = total - listed.length;
  if (unlisted > 0) {
    return `${listed.join(", ")} and ${unlisted} more`;
  }
  return listed.join(", ");
}

export interface ClaudeCodeGeneratorOptions {
  /** Binary path or name (PATH-resolved by spawn). */
  command: string;
  model?: string | undefined;
  failureDir: string;
  timeouts?: HarnessTimeoutOverrides | undefined;
  /** Spawn env, from the composition root (the CLI needs HOME for its login). */
  env: Record<string, string | undefined>;
  /**
   * Served-model mismatch surfacing hook (trust-but-verify): fired when the
   * result envelope's `modelUsage` keys don't include the requested model.
   * `served` is the rendered, capped key list, never the raw keys.
   * The origin stamp stays the declaration either way.
   */
  onModelMismatch?: ((requested: string, served: string[]) => void) | undefined;
}

/** The stream-json events the adapter reads. Everything else is ignored. */
interface ResultEnvelope {
  subtype: string;
  isError: boolean;
  result: string;
  /** The last API turn's stop reason; `max_tokens` means the output was cut. */
  stopReason: string | null;
  /**
   * Presence tracked separately from value: `structured_output: null` is a
   * schema-valid answer for null-accepting schemas, distinct from the field
   * being absent (raw-result fallback).
   */
  hasStructuredOutput: boolean;
  structuredOutput: unknown;
  modelUsage: string[] | null;
  /** The run's `usage`, `modelUsage` and `total_cost_usd` as sent, read only through `readRunUsage`. */
  rawUsage: unknown;
  rawModelUsage: unknown;
  rawCostUsd: unknown;
}

export class ClaudeCodeGenerator implements Generator {
  private readonly command: string;
  private readonly model: string;
  private readonly failureDir: string;
  private readonly timeouts: HarnessTimeouts;
  private readonly onModelMismatch:
    | ((requested: string, served: string[]) => void)
    | undefined;
  private readonly env: Record<string, string | undefined>;

  constructor(options: ClaudeCodeGeneratorOptions) {
    this.command = options.command;
    this.model = options.model ?? DEFAULT_MODEL;
    this.failureDir = options.failureDir;
    this.timeouts = resolveHarnessTimeouts(options.timeouts);
    this.onModelMismatch = options.onModelMismatch;
    this.env = options.env;
  }

  origin(effort: Effort): Generation {
    // Honest capability gap: no headless effort knob, the requested effort
    // is deliberately NOT echoed into the stamp.
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
        GeneratorErrorKinds.CONFIG,
        `schema for ${req.label} is not representable as a strict JSON schema: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
        { cause: error },
      );
    }

    // The system prompt travels by file (argv would re-expose ARG_MAX);
    // one directory per generate() covers both attempts, cleaned in finally.
    const workDir = createHarnessWorkDir("claude-code-gen-");
    const systemFile = join(workDir.root, "system-prompt.txt");

    const floorArgs: RunWithSchemaFloorArgs<S> = {
      schema: req.schema,
      label: req.label,
      failureDir: this.failureDir,
      log,
      attempt: async (feedback) => {
        // Stateless CLI: every retry is a fresh process, feedback stitched
        // after the user turn (no assistant-turn boundary).
        const user = joinUserText(req);
        const prompt = feedback
          ? `${user}\n\n[Your previous response]\n${feedback.raw}\n\n${schemaFeedbackMessage(feedback.error)}`
          : user;
        log(
          `${feedback ? "retrying" : "generating"} ${req.label} via ${this.command}…`,
        );
        const runArgs: HarnessRunArgs = {
          env: this.env,
          cliEnv: CLAUDE_CLI_ENV,
          command: this.command,
          argv: [
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
            this.model,
            "--system-prompt-file",
            systemFile,
            "--json-schema",
            JSON.stringify(wireSchema),
          ],
          stdin: prompt,
          timeouts: this.timeouts,
          cwd: workDir.cwd,
          log,
        };
        if (req.signal) {
          runArgs.signal = req.signal;
        }
        if (req.maxOutputTokens !== undefined) {
          const ceiling = readClaudeOutputCeiling(this.model);
          const cap = Math.min(req.maxOutputTokens, ceiling);
          runArgs.requestEnv = { [OUTPUT_CAP_VAR]: String(cap) };
        }
        const run = await runHarnessProcess(runArgs);
        return this.interpret(req.label, run, log, req.onWarning, req.onUsage);
      },
    };
    if (req.salvageFields) {
      floorArgs.salvageFields = req.salvageFields;
    }
    if (req.onWarning) {
      floorArgs.onWarning = req.onWarning;
    }
    if (req.redact) {
      floorArgs.redact = req.redact;
    }
    if (req.screenAttempt) {
      floorArgs.screenAttempt = req.screenAttempt;
    }

    try {
      writeFileSync(systemFile, req.system, { mode: 0o600 });
      return await runWithSchemaFloor(floorArgs);
    } finally {
      removeHarnessWorkDir(workDir, log);
    }
  }

  /** Map one finished CLI run onto a floor attempt or a classified throw. */
  private interpret(
    label: string,
    run: HarnessRunResult,
    log: Logger,
    onWarning: GeneratorWarningSink | undefined,
    onUsage: ((usage: TokenUsage) => void) | undefined,
  ): FloorAttempt {
    if (run.timedOut) {
      throw harnessTimeoutError(label, run);
    }

    let envelope: ResultEnvelope | null = null;
    let lastApiRetryCategory: string | null = null;
    for (const line of run.stdout.split("\n")) {
      const event = parseEventLine(line);
      if (event === null) {
        continue;
      }
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
          : undefined) ?? GeneratorErrorKinds.OPAQUE;
      throw new GeneratorError(
        kind,
        `${this.command} exited (code ${run.exitCode ?? `signal ${run.exitSignal ?? "unknown"}`}) without a result envelope for ${label}${
          lastApiRetryCategory !== null
            ? ` after ${renderCategory(lastApiRetryCategory)}`
            : ""
        }`,
      );
    }

    // One report per CLI run, summed over its API requests; billed even when
    // the run reported an error after the envelope.
    const usage = readRunUsage(envelope, this.model);
    if (usage !== undefined) {
      onUsage?.(usage);
    }

    this.verifyServedModel(envelope, log, onWarning);

    if (envelope.stopReason === CUT_STOP_REASON) {
      return { raw: envelope.result, cut: true };
    }

    if (envelope.subtype === "error_max_structured_output_retries") {
      // The CLI exhausted its own enforcement retries, but our floor is
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
        GeneratorErrorKinds.OPAQUE,
        `${this.command} reported ${renderErrorSubtype(envelope.subtype)} for ${label}`,
      );
    }
    if (envelope.hasStructuredOutput) {
      // Parsed candidate + raw fallback: the floor validates the candidate
      // first and falls back to the raw text if it was reshaped in flight.
      // An explicit null candidate rides through, it is schema-valid for
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
  private verifyServedModel(
    envelope: ResultEnvelope,
    log: Logger,
    onWarning: GeneratorWarningSink | undefined,
  ): void {
    if (envelope.modelUsage === null) {
      // Missing/drifted modelUsage: verification is UNAVAILABLE, which must
      // surface rather than silently pass, served [] means "could not
      // verify", distinct from a concrete mismatch.
      const unverifiedMessage = `warning: result envelope carried no modelUsage — served model for ${this.model} is unverifiable`;
      log(unverifiedMessage);
      onWarning?.({
        kind: GeneratorWarningKinds.SERVED_MODEL_UNVERIFIED,
        message: unverifiedMessage,
      });
      this.onModelMismatch?.(this.model, []);
      return;
    }
    if (envelope.modelUsage.includes(this.model)) {
      return;
    }

    const served = listServedModels(envelope.modelUsage);
    const reported = describeServedModels(served, envelope.modelUsage.length);
    const mismatchMessage = `warning: requested model ${this.model} but modelUsage reports ${reported} — origin stamp stays the declaration`;
    log(mismatchMessage);
    onWarning?.({
      kind: GeneratorWarningKinds.SERVED_MODEL_MISMATCH,
      message: mismatchMessage,
    });
    this.onModelMismatch?.(this.model, served);
  }
}

/** One parsed stream-json line, narrowed to the events the adapter reads. */
type StreamEvent =
  | { type: "system"; subtype: string; errorCategory: string | null }
  | { type: "result"; envelope: ResultEnvelope };

function parseEventLine(line: string): StreamEvent | null {
  if (line.trim() === "") {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null; // Non-JSON noise on stdout is not ours to interpret.
  }
  if (typeof value !== "object" || value === null) {
    return null;
  }
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
    const stopReason = Reflect.get(value, "stop_reason");
    const modelUsage = Reflect.get(value, "modelUsage");
    return {
      type: "result",
      envelope: {
        subtype: typeof subtype === "string" ? subtype : "",
        isError: isError === true,
        result: typeof result === "string" ? result : "",
        stopReason: typeof stopReason === "string" ? stopReason : null,
        hasStructuredOutput: Reflect.has(value, "structured_output"),
        structuredOutput: Reflect.get(value, "structured_output"),
        modelUsage:
          typeof modelUsage === "object" && modelUsage !== null
            ? Object.keys(modelUsage)
            : null,
        rawUsage: Reflect.get(value, "usage"),
        rawModelUsage: modelUsage,
        rawCostUsd: Reflect.get(value, "total_cost_usd"),
      },
    };
  }
  return null;
}

function readField(source: unknown, key: string): unknown {
  if (typeof source !== "object" || source === null) {
    return undefined;
  }
  return Reflect.get(source, key);
}

function parseCount(value: unknown): number | undefined {
  if (typeof value !== "number") {
    return undefined;
  }
  const isCount = Number.isFinite(value) && value >= 0;
  if (!isCount) {
    return undefined;
  }
  return value;
}

function readCount(source: unknown, key: string): number | undefined {
  return parseCount(readField(source, key));
}

function readModelEntry(modelUsage: unknown, model: string): unknown {
  if (typeof modelUsage !== "object" || modelUsage === null) {
    return undefined;
  }
  if (Object.hasOwn(modelUsage, model)) {
    return Reflect.get(modelUsage, model);
  }
  return Object.values(modelUsage)[0];
}

/**
 * Maps the result envelope's `usage` (API casing) and `modelUsage` entry
 * (camelCase) onto one report; a missing count reads as 0 and an absent
 * optional field stays absent. Undefined when the envelope carries neither.
 */
function readRunUsage(
  envelope: ResultEnvelope,
  model: string,
): TokenUsage | undefined {
  const usage = envelope.rawUsage;
  const entry = readModelEntry(envelope.rawModelUsage, model);
  const hasUsage = typeof usage === "object" && usage !== null;
  const hasUsageSource = hasUsage || entry !== undefined;
  if (!hasUsageSource) {
    return undefined;
  }

  const report: TokenUsage = {
    inputTokens:
      readCount(usage, "input_tokens") ?? readCount(entry, "inputTokens") ?? 0,
    outputTokens:
      readCount(usage, "output_tokens") ??
      readCount(entry, "outputTokens") ??
      0,
    cacheReadTokens:
      readCount(usage, "cache_read_input_tokens") ??
      readCount(entry, "cacheReadInputTokens") ??
      0,
  };
  const cacheWriteTokens =
    readCount(usage, "cache_creation_input_tokens") ??
    readCount(entry, "cacheCreationInputTokens");
  if (cacheWriteTokens !== undefined) {
    report.cacheWriteTokens = cacheWriteTokens;
  }
  const outputDetails = readField(usage, "output_tokens_details");
  const reasoningTokens =
    readCount(outputDetails, "thinking_tokens") ??
    readCount(entry, "thinkingTokens");
  if (reasoningTokens !== undefined) {
    report.reasoningTokens = reasoningTokens;
  }
  const costUsd =
    parseCount(envelope.rawCostUsd) ?? readCount(entry, "costUSD");
  if (costUsd !== undefined) {
    report.costUsd = costUsd;
  }
  const contextWindowTokens = readCount(entry, "contextWindow");
  if (contextWindowTokens !== undefined) {
    report.contextWindowTokens = contextWindowTokens;
  }
  const maxOutputTokens = readCount(entry, "maxOutputTokens");
  if (maxOutputTokens !== undefined) {
    report.maxOutputTokens = maxOutputTokens;
  }
  return report;
}

// Boot-probe billing checks: a version-floor warning and a billing-route
// assertion, both reading stdout the probe already produces. The route assertion
// closes the `apiKeyHelper` residual hole, since a settings-file override is
// invisible to the env strip but `auth status --json` reports it.

/**
 * claude's own login and config vars, plus its update and nonessential
 * traffic off switches. `CLAUDE_CODE_OAUTH_TOKEN` is the subscription route;
 * `ANTHROPIC_API_KEY` stays out, so it can never rebill to an API account.
 */
export const CLAUDE_CLI_ENV: HarnessCliEnv = {
  passVars: ["CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR"],
  fixedVars: {
    DISABLE_AUTOUPDATER: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  },
  requestVars: [OUTPUT_CAP_VAR],
};

/** Boot-probe wiring shared with the registry entry (CODEX_PROBE pattern). */
export const CLAUDE_PROBE = {
  versionArgv: ["--version"],
  /** `--json` is the default output format of `auth status`. */
  authArgv: ["auth", "status"],
  authFailureHint:
    "run `claude /login` interactively on this machine (or set CLAUDE_CODE_OAUTH_TOKEN; an ANTHROPIC_API_KEY cannot authenticate this provider — the harness strips it)",
} as const;

/**
 * The claude version the hardening was last checked on. It also clears the
 * 2.1.226 floor below which the CLI billed subscription OAuth runs to the
 * Console API account.
 */
export const CLAUDE_VERSION_POLICY: CliVersionPolicy = {
  cli: "claude",
  tested: "2.1.307",
  updateHint: "update the CLI (`claude update`)",
};

/**
 * The `auth status --json` fields the assertion reads; unknown fields are ignored
 * and missing ones degrade to unverifiable. Route table verified at CLI 2.1.226:
 * keychain login is `claude.ai` and CLAUDE_CODE_OAUTH_TOKEN is `oauth_token`,
 * both subscription, while `api_key_helper` and any apiKeySource are API key.
 */
const authStatusShape = z.object({
  // Per-field `catch`: one drifted field (e.g. `authMethod: null`, the CLI
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
  "warning: could not read the billing route from `claude auth status` — subscription billing is unverifiable (CLI older than the auth-status JSON surface?); upgrade the CLI to restore the boot-time assertion";

function refuseBillingRoute(detail: string): ReturnType<typeof configError> {
  return configError([
    `claude CLI billing route is ${detail}, not the subscription login — refusing to start rather than bill an API account. Remove any apiKeyHelper entry from the CLI's settings.json, unset API key env vars, then verify with \`claude auth status\``,
  ]);
}

/**
 * Billing-route assertion, refuse on mismatch. Positive-evidence refusals
 * only: output that doesn't carry the fields warns "unverifiable" instead of
 * refusing, since refusing on a parse gap would brick every pre-floor CLI.
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
  if (!status.success) {
    return { ok: true, value: UNVERIFIABLE_WARNING };
  }
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
