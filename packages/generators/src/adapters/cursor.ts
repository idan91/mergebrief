import { mkdtempSync, rmSync } from "node:fs";
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
  type FloorAttempt,
  type RunWithSchemaFloorArgs,
} from "../validation/enforceSchema";
import type {
  GenerateRequest,
  Generator,
  Logger,
  TokenUsage,
} from "../contract/generator";
import { harnessTimeoutError } from "../harness/redact";
import {
  resolveHarnessTimeouts,
  runHarnessProcess,
  type HarnessRunArgs,
  type HarnessRunResult,
  type HarnessTimeoutOverrides,
  type HarnessTimeouts,
} from "../harness/run";
import type { Effort, Generation } from "../contract/generation";

/**
 * Cursor CLI adapter: one `cursor-agent -p` process per attempt, stream-json
 * envelopes on stdout, prompt via stdin.
 *
 * Invariants:
 * 1. Schema floor is hard — no CLI schema flag exists, so
 *    `runWithSchemaFloor` is the ONLY enforcement.
 * 2. Abort rejections propagate untouched.
 * 3. Origin is a declaration — no served-model signal exists, so no
 *    mismatch hook; unset model stamps "cursor-default" with effort null.
 * 4. No secrets in errors: stderr classifies via allowlist to fixed text
 *    (redacted tail only via `harnessTimeoutError`); the probe's
 *    `userEmail` never leaves it.
 * 5. Lockdown is `--mode plan` from a fresh empty temp cwd — bare print
 *    mode writes files; `--trust` prevents the trust-prompt hang.
 * 6. The stream is pipe-silent until exit — inactivity defaults to the
 *    hard ceiling, wall-clock is the only watchdog.
 */

const CURSOR_DEFAULT_MODEL_TOKEN = "cursor-default";

export interface CursorGeneratorOptions {
  /** Binary path or name (PATH-resolved by spawn). */
  command: string;
  /**
   * BARE model id for --model (the effort bracket is appended per request);
   * absent → the CLI's configured default runs (the origin stamp shows
   * "cursor-default" and effort null — no flag, no bracket to carry it).
   */
  model?: string | undefined;
  failureDir: string;
  timeouts?: HarnessTimeoutOverrides | undefined;
  /** Spawn env; defaults to process.env (the CLI needs HOME/keychain). */
  env?: Record<string, string | undefined> | undefined;
}

export class CursorGenerator implements Generator {
  private readonly command: string;
  private readonly model: string | undefined;
  private readonly failureDir: string;
  private readonly timeouts: HarnessTimeouts;
  private readonly env: Record<string, string | undefined> | undefined;

  constructor(options: CursorGeneratorOptions) {
    this.command = options.command;
    this.model = options.model;
    this.failureDir = options.failureDir;
    this.timeouts = resolveCursorTimeouts(options.timeouts);
    this.env = options.env;
  }

  origin(effort: Effort): Generation {
    if (this.model === undefined) {
      // No --model flag → no bracket to carry effort: both gaps surface.
      return {
        provider: "cursor",
        model: CURSOR_DEFAULT_MODEL_TOKEN,
        effort: null,
      };
    }
    return { provider: "cursor", model: this.model, effort };
  }

  async generate<S extends z.ZodType>(
    req: GenerateRequest<S>,
  ): Promise<z.infer<S>> {
    const log = req.log ?? (() => {});

    // Fresh EMPTY temp cwd per generate(): plan mode still reads the
    // workspace, so a generation must never see repo or ambient files.
    // One dir covers both attempts, removed best-effort below.
    const workDir = mkdtempSync(join(tmpdir(), "cursor-gen-"));

    const floorArgs: RunWithSchemaFloorArgs<S> = {
      schema: req.schema,
      label: req.label,
      failureDir: this.failureDir,
      log,
      attempt: async (feedback) => {
        // Stateless CLI: every retry is a fresh process, feedback stitched
        // into stdin (no system-prompt channel).
        const prompt = feedback
          ? `${req.system}\n\n${req.user}\n\n[Your previous response]\n${feedback.raw}\n\n${schemaFeedbackMessage(feedback.error)}`
          : `${req.system}\n\n${req.user}`;
        log(
          `${feedback ? "retrying" : "generating"} ${req.label} via ${this.command}…`,
        );
        const argv = [
          "-p",
          "--output-format",
          "stream-json",
          "--mode",
          "plan",
          "--trust",
        ];
        if (this.model !== undefined) {
          argv.push("--model", `${this.model}[effort=${req.effort}]`);
        }
        const runArgs: HarnessRunArgs = {
          command: this.command,
          argv,
          stdin: prompt,
          timeouts: this.timeouts,
          cwd: workDir,
          log,
        };
        if (this.env) runArgs.env = this.env;
        if (req.signal) runArgs.signal = req.signal;
        const run = await runHarnessProcess(runArgs);
        const interpretArgs: InterpretCursorRunArgs = {
          command: this.command,
          label: req.label,
          run,
          log,
        };
        if (req.onUsage) interpretArgs.onUsage = req.onUsage;
        return interpretCursorRun(interpretArgs);
      },
    };
    if (req.salvageFields) floorArgs.salvageFields = req.salvageFields;

    try {
      return await runWithSchemaFloor(floorArgs);
    } finally {
      // Best-effort: a throw here would REPLACE the in-flight rejection.
      try {
        rmSync(workDir, { recursive: true, force: true });
      } catch {
        log(`note: could not remove temp dir ${workDir}`);
      }
    }
  }
}

/**
 * Failures arrive as exit 1 + stderr prefixes, not in-band JSON. The tail is
 * untrusted — matches render FIXED text, never the stderr itself.
 */
function classifyStderr(
  command: string,
  label: string,
  stderrTail: string,
): GeneratorError | null {
  if (stderrTail.includes("Authentication required")) {
    return new GeneratorError(
      GeneratorErrorKind.AUTH,
      `${command}: not authenticated for ${label} — run \`cursor-agent login\` or set CURSOR_API_KEY`,
    );
  }
  if (stderrTail.includes("Cannot use this model")) {
    return new GeneratorError(
      GeneratorErrorKind.CONFIG,
      `${command}: rejected the configured model for ${label} — check \`cursor-agent --list-models\``,
    );
  }
  if (stderrTail.includes("error: unknown option")) {
    return new GeneratorError(
      GeneratorErrorKind.CONFIG,
      `${command}: rejected an option for ${label} — the installed CLI may predate this adapter's argv contract; update it (\`cursor-agent update\`)`,
    );
  }
  return null;
}

/** Allowlisted rendering of untrusted init fields (no-secrets invariant). */
const KNOWN_API_KEY_SOURCES = new Set(["login", "env"]);

function renderApiKeySource(source: string): string {
  return KNOWN_API_KEY_SOURCES.has(source) ? source : "an unrecognized source";
}

/**
 * Lockdown trust-but-verify (the verifyServedModel posture): `system/init`
 * echoes the permission mode — the one lockdown claim the CLI makes
 * checkable. Anything but "plan" warns; a warning, not a throw, because the
 * echo is a claim, not proof, and refusing on drift would brick a CLI whose
 * generation is otherwise sound. Rendered text is fixed — the mode string is
 * untrusted and never rides along.
 */
function describePermissionModeDrift(mode: string | null): string | null {
  if (mode === "plan") return null;
  const reported =
    mode === null ? "no permission mode" : "an unrecognized mode";
  return `warning: requested --mode plan but system/init reported ${reported} — the write lockdown is unverified`;
}

/** The only documented non-error subtype; everything else is drift. */
const KNOWN_RESULT_SUBTYPES = new Set(["success"]);

function renderSubtype(subtype: string): string {
  return KNOWN_RESULT_SUBTYPES.has(subtype) ? subtype : "an unrecognized error";
}

/** The stream-json events the adapter reads. Everything else is ignored. */
interface CursorResultEnvelope {
  subtype: string;
  isError: boolean;
  result: string;
  usage: TokenUsage | null;
}

type CursorEvent =
  | {
      kind: "init";
      apiKeySource: string | null;
      permissionMode: string | null;
    }
  | { kind: "result"; envelope: CursorResultEnvelope };

function readUsage(value: unknown): TokenUsage | null {
  if (typeof value !== "object" || value === null) return null;
  const inputTokens = Reflect.get(value, "inputTokens");
  const outputTokens = Reflect.get(value, "outputTokens");
  const cacheReadTokens = Reflect.get(value, "cacheReadTokens");
  if (typeof inputTokens !== "number" || typeof outputTokens !== "number") {
    return null;
  }
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens: typeof cacheReadTokens === "number" ? cacheReadTokens : 0,
  };
}

function parseCursorLine(line: string): CursorEvent | null {
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
    if (Reflect.get(value, "subtype") !== "init") return null;
    const apiKeySource = Reflect.get(value, "apiKeySource");
    const permissionMode = Reflect.get(value, "permissionMode");
    return {
      kind: "init",
      apiKeySource: typeof apiKeySource === "string" ? apiKeySource : null,
      permissionMode:
        typeof permissionMode === "string" ? permissionMode : null,
    };
  }
  if (type === "result") {
    const subtype = Reflect.get(value, "subtype");
    const isError = Reflect.get(value, "is_error");
    const result = Reflect.get(value, "result");
    return {
      kind: "result",
      envelope: {
        subtype: typeof subtype === "string" ? subtype : "",
        isError: isError === true,
        result: typeof result === "string" ? result : "",
        usage: readUsage(Reflect.get(value, "usage")),
      },
    };
  }
  return null;
}

interface InterpretCursorRunArgs {
  command: string;
  label: string;
  run: HarnessRunResult;
  log: Logger;
  onUsage?: (usage: TokenUsage) => void;
}

/** Map one finished cursor run onto a floor attempt or a classified throw. */
function interpretCursorRun(args: InterpretCursorRunArgs): FloorAttempt {
  const { command, label, run } = args;
  if (run.timedOut) {
    throw harnessTimeoutError(label, run);
  }

  let envelope: CursorResultEnvelope | null = null;
  for (const line of run.stdout.split("\n")) {
    const event = parseCursorLine(line);
    if (event === null) continue;
    if (event.kind === "init") {
      // Billing-route observability: "env" means CURSOR_API_KEY outranked
      // the stored login (same subscription pool either way).
      if (event.apiKeySource !== null) {
        args.log(
          `${command} apiKeySource: ${renderApiKeySource(event.apiKeySource)}`,
        );
      }
      const drift = describePermissionModeDrift(event.permissionMode);
      if (drift !== null) args.log(drift);
    } else {
      envelope = event.envelope;
    }
  }

  // Tokens were billed even when the run failed after the envelope.
  if (envelope?.usage) args.onUsage?.(envelope.usage);

  if (envelope === null || run.exitCode !== 0) {
    const classified = classifyStderr(command, label, run.stderrTail);
    if (classified) throw classified;
    const outcome =
      envelope === null
        ? "without a result envelope"
        : "after a result envelope";
    throw new GeneratorError(
      GeneratorErrorKind.OPAQUE,
      `${command} exited (code ${run.exitCode ?? `signal ${run.exitSignal ?? "unknown"}`}) ${outcome} for ${label}`,
    );
  }
  if (envelope.isError) {
    throw new GeneratorError(
      GeneratorErrorKind.OPAQUE,
      `${command} reported ${envelope.subtype === "" ? "an error" : renderSubtype(envelope.subtype)} for ${label}`,
    );
  }
  if (envelope.result === "") {
    return {
      raw: "",
      invalidReason: `No output for ${label} (subtype=${renderSubtype(envelope.subtype)})`,
    };
  }
  return { raw: envelope.result };
}

/**
 * Inactivity collapses to the hard ceiling by default (invariant 6). An
 * explicit override survives for an operator who verified a streaming mode
 * that does reach the pipe.
 */
export function resolveCursorTimeouts(
  overrides: HarnessTimeoutOverrides | undefined,
): HarnessTimeouts {
  const resolved = resolveHarnessTimeouts(overrides);
  return {
    ...resolved,
    inactivityMs: overrides?.inactivityMs ?? resolved.hardMs,
  };
}

// ---------------------------------------------------------------------------
// Boot-probe interpreters: a headless-contract version floor (warn-only) and
// the auth verdict. Both exist because the CLI's own exits are auth-blind:
// `about` exits 0 logged out — the verdict lives in its JSON body.
// ---------------------------------------------------------------------------

/** Boot-probe wiring shared with the registry entry (CODEX_PROBE pattern). */
export const CURSOR_PROBE = {
  versionArgv: ["--version"],
  /** `status` exits 0 even logged out; `about --format json` carries the verdict. */
  authArgv: ["about", "--format", "json"],
  authFailureHint:
    "run `cursor-agent login` interactively on this machine (or set CURSOR_API_KEY — it bills the same subscription pool)",
} as const;

/**
 * Oldest CLI whose headless contract (plan-mode lockdown, envelope shape,
 * stderr taxonomy) was execution-verified. Date-versioned: compare the
 * YYYY.MM.DD prefix, ignore the build-hash suffix.
 */
export const CURSOR_VERSION_FLOOR = "2026.08.25";

const DATE_VERSION_SHAPE = /(\d{4})\.(\d{2})\.(\d{2})/;

interface DateVersion {
  /** The matched YYYY.MM.DD text — regex-constrained, safe to render. */
  date: string;
  parts: [number, number, number];
}

function parseCursorVersion(text: string): DateVersion | null {
  const match = DATE_VERSION_SHAPE.exec(text);
  if (match === null) return null;
  const [date, year, month, day] = match;
  return { date, parts: [Number(year), Number(month), Number(day)] };
}

/**
 * Version-floor check, warn-only: the floor is about contract verification,
 * not ability to run. Unparseable output warns too — "could not verify"
 * must surface, never silently pass.
 */
export function buildCursorVersionWarning(stdout: string): string | null {
  const seen = parseCursorVersion(stdout);
  if (seen === null) {
    return `warning: could not read a version from the cursor-agent --version output — the headless-contract floor ${CURSOR_VERSION_FLOOR} is unverifiable`;
  }
  const floor = parseCursorVersion(CURSOR_VERSION_FLOOR);
  if (floor === null) return null; // unreachable: the floor constant parses
  for (let i = 0; i < 3; i++) {
    const a = seen.parts[i] ?? 0;
    const b = floor.parts[i] ?? 0;
    if (a > b) return null;
    if (a < b) {
      return `warning: cursor-agent ${seen.date} is older than ${CURSOR_VERSION_FLOOR}, the oldest version this adapter's headless contract was verified against — envelope and flag behavior may differ; update the CLI (\`cursor-agent update\`)`;
    }
  }
  return null;
}

/**
 * The `about --format json` fields the verdict reads (lenient shape —
 * unknown fields ignored; a drifted field degrades that field to absent, so
 * positive evidence in the OTHER field still decides).
 */
const aboutShape = z.object({
  userEmail: z.string().nullish().catch(undefined),
  subscriptionTier: z.string().nullish().catch(undefined),
});

const hasEvidence = (value: string | null | undefined): boolean =>
  typeof value === "string" && value.length > 0;

const ABOUT_UNVERIFIABLE_WARNING =
  "warning: could not read the account identity from `cursor-agent about --format json` — authentication is unverifiable before the first generation (envelope drift?); update the CLI";

/**
 * Auth verdict — `about` is exit-blind, so this JSON read IS the preflight.
 * Null identity fields are the positive logged-out signal and refuse boot;
 * output without them warns "unverifiable" instead (refusing on a parse gap
 * would brick every pre-floor CLI). The email itself is PII and never
 * appears in a verdict.
 */
export function interpretCursorAbout(
  stdout: string,
): Result<string | null, ConfigError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { ok: true, value: ABOUT_UNVERIFIABLE_WARNING };
  }
  const about = aboutShape.safeParse(parsed);
  if (!about.success) return { ok: true, value: ABOUT_UNVERIFIABLE_WARNING };
  const { userEmail, subscriptionTier } = about.data;

  if (hasEvidence(userEmail) || hasEvidence(subscriptionTier)) {
    return { ok: true, value: null };
  }
  if (userEmail === null || subscriptionTier === null) {
    return configError([
      "cursor-agent reports no logged-in account — not authenticated. Run `cursor-agent login` on this machine, or set CURSOR_API_KEY (it bills the same subscription pool)",
    ]);
  }
  return { ok: true, value: ABOUT_UNVERIFIABLE_WARNING };
}
