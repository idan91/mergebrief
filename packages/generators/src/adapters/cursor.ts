import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod/v4";
import type { Result } from "types";
import {
  configError,
  GeneratorError,
  GeneratorErrorKinds,
  type ConfigError,
} from "../contract/errors";
import {
  runWithSchemaFloor,
  schemaFeedbackMessage,
  type FloorAttempt,
  type RunWithSchemaFloorArgs,
} from "../validation/enforceSchema";
import { enumPreservingJsonSchema } from "../validation/jsonSchema";
import type {
  GenerateRequest,
  Generator,
  Logger,
  TokenUsage,
} from "../contract/generator";
import { harnessTimeoutError, redactSecrets } from "../harness/redact";
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
 * 1. Schema floor is hard, no CLI schema flag exists, so
 *    `runWithSchemaFloor` is the ONLY enforcement.
 * 2. Abort rejections propagate untouched.
 * 3. Origin is a declaration, no served-model signal exists, so no
 *    mismatch hook; unset model stamps "cursor-default". Effort rides the
 *    model-id VARIANT (`--model` accepts only `--list-models` ids, no
 *    bracket overrides); the stamp parses the id's suffix.
 * 4. No secrets in errors: stderr classifies via allowlist to fixed text
 *    (redacted tail only via `harnessTimeoutError`); the probe's
 *    `userEmail` never leaves it.
 * 5. Lockdown is `--mode plan` from a fresh empty temp cwd, bare print
 *    mode writes files; `--trust` prevents the trust-prompt hang.
 * 6. The stream is pipe-silent until exit, inactivity defaults to the
 *    hard ceiling, wall-clock is the only watchdog.
 */

const CURSOR_DEFAULT_MODEL_TOKEN = "cursor-default";

/**
 * The transport's answer-shape contract, stitched at the END of every
 * prompt: plan-mode models (grok, composer) narrate around or instead of
 * the answer, and omit empty required arrays. Recovery exists
 * (extractJsonCandidate + the floor), but compliance beats salvage.
 */
const CURSOR_OUTPUT_CONTRACT =
  "Respond with ONLY the JSON object conforming to the schema above — no narration, no plan, no code fences, no text before or after the object. " +
  "Every field the schema requires must be present: emit empty arrays as [] rather than omitting them.";

/**
 * The `--list-models` id vocabulary bakes effort into the id
 * (`gpt-5.2-high`, `cursor-grok-4.6-low-fast`). Parse the suffix back into
 * the normalized vocabulary; anything outside it (bare ids, `-xhigh`)
 * stamps null, the id itself carries the full truth either way.
 */
const BAKED_EFFORT_SHAPE = /-(low|medium|high|xhigh)(?:-fast)?$/;

function parseBakedEffort(model: string): Effort | null {
  const match = BAKED_EFFORT_SHAPE.exec(model);
  if (match === null) return null;
  const suffix = match[1];
  if (suffix === "low" || suffix === "medium" || suffix === "high") {
    return suffix;
  }
  return null; // -xhigh: outside the normalized vocabulary.
}

export interface CursorGeneratorOptions {
  /** Binary path or name (PATH-resolved by spawn). */
  command: string;
  /**
   * Model id for --model, VERBATIM from `--list-models`, effort rides the
   * id variant (`gpt-5.2-high`, `cursor-grok-4.6-low`); bracket overrides
   * are rejected by the CLI (execution-verified). Absent → the CLI's
   * configured default runs (the origin stamp shows "cursor-default").
   */
  model?: string | undefined;
  failureDir: string;
  timeouts?: HarnessTimeoutOverrides | undefined;
  /** Spawn env, from the composition root (the CLI needs HOME for its login). */
  env: Record<string, string | undefined>;
}

export class CursorGenerator implements Generator {
  private readonly command: string;
  private readonly model: string | undefined;
  private readonly failureDir: string;
  private readonly timeouts: HarnessTimeouts;
  private readonly env: Record<string, string | undefined>;

  constructor(options: CursorGeneratorOptions) {
    this.command = options.command;
    this.model = options.model;
    this.failureDir = options.failureDir;
    this.timeouts = resolveCursorTimeouts(options.timeouts);
    this.env = options.env;
  }

  origin(effort: Effort): Generation {
    // Effort rides the model-id VARIANT, never a knob of its own, the
    // stamp echoes what the id itself declares, not what was requested.
    void effort;
    if (this.model === undefined) {
      return {
        provider: "cursor",
        model: CURSOR_DEFAULT_MODEL_TOKEN,
        effort: null,
      };
    }
    return {
      provider: "cursor",
      model: this.model,
      effort: parseBakedEffort(this.model),
    };
  }

  async generate<S extends z.ZodType>(
    req: GenerateRequest<S>,
  ): Promise<z.infer<S>> {
    const log = req.log ?? (() => {});

    // The CLI has no schema flag, so the wire schema rides the PROMPT,
    // this adapter's equivalent of claude's --json-schema / codex's
    // --output-schema. Without it the model is told to conform to a schema
    // it never received (prompt.ts says "the provided JSON schema").
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
    const schemaBlock = `The JSON schema your response must conform to:\n${JSON.stringify(wireSchema)}`;

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
        // Stateless CLI: every retry is a fresh process, system, schema,
        // feedback stitch into stdin; the output contract sits LAST
        // (the final instruction carries the most weight).
        const base = `${req.system}\n\n${schemaBlock}\n\n${req.user}`;
        const prompt = feedback
          ? `${base}\n\n[Your previous response]\n${feedback.raw}\n\n${schemaFeedbackMessage(feedback.error)}\n\n${CURSOR_OUTPUT_CONTRACT}`
          : `${base}\n\n${CURSOR_OUTPUT_CONTRACT}`;
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
          // VERBATIM, the CLI accepts only --list-models ids; bracket
          // overrides are rejected outright (execution-verified).
          argv.push("--model", this.model);
          if (parseBakedEffort(this.model) !== req.effort) {
            log(
              `note: cursor selects effort via the model-id variant — requested effort ${req.effort} does not ride the wire (configured id: ${this.model})`,
            );
          }
        }
        const runArgs: HarnessRunArgs = {
          env: this.env,
          command: this.command,
          argv,
          stdin: prompt,
          timeouts: this.timeouts,
          cwd: workDir,
          log,
        };
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
 * untrusted, matches render FIXED text, never the stderr itself.
 */
function classifyStderr(
  command: string,
  label: string,
  stderrTail: string,
): GeneratorError | null {
  if (stderrTail.includes("Authentication required")) {
    return new GeneratorError(
      GeneratorErrorKinds.AUTH,
      `${command}: not authenticated for ${label} — run \`cursor-agent login\` or set CURSOR_API_KEY`,
    );
  }
  // Both needles: the rejection lists ~200 available ids after the prefix,
  // which flushes "Cannot use this model" out of the 4KB rolling tail,
  // "Available models" is what survives at the end.
  if (
    stderrTail.includes("Cannot use this model") ||
    stderrTail.includes("Available models")
  ) {
    return new GeneratorError(
      GeneratorErrorKinds.CONFIG,
      `${command}: rejected the configured model for ${label} — check \`cursor-agent --list-models\``,
    );
  }
  if (stderrTail.includes("error: unknown option")) {
    return new GeneratorError(
      GeneratorErrorKinds.CONFIG,
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
 * Lockdown trust-but-verify: `system/init` echoes the permission mode, the one
 * lockdown claim the CLI makes checkable. Anything but "plan" warns rather than
 * throws, because the echo is a claim and refusing on drift would brick a CLI
 * whose generation is sound. Rendered text is fixed; the mode never rides along.
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
    // Head AND tail: the failure prefix lives at the head, and a long
    // payload after it (the ~200-id available-models list) flushes it out
    // of the rolling tail.
    const classified = classifyStderr(
      command,
      label,
      `${run.stderrHead}\n${run.stderrTail}`,
    );
    if (classified) throw classified;
    const outcome =
      envelope === null
        ? "without a result envelope"
        : "after a result envelope";
    // stderr is this CLI's ONLY error channel (nothing rides in-band), so an
    // unclassified failure carries the head (where the cause is stated),
    // redacted BEFORE truncating, same boundary as harnessTimeoutError.
    const detail = redactSecrets(
      (run.stderrHead === "" ? run.stderrTail : run.stderrHead).trim(),
    ).slice(0, 500);
    const stderrNote = detail === "" ? "" : `; stderr: ${detail}`;
    throw new GeneratorError(
      GeneratorErrorKinds.OPAQUE,
      `${command} exited (code ${run.exitCode ?? `signal ${run.exitSignal ?? "unknown"}`}) ${outcome} for ${label}${stderrNote}`,
    );
  }
  if (envelope.isError) {
    throw new GeneratorError(
      GeneratorErrorKinds.OPAQUE,
      `${command} reported ${envelope.subtype === "" ? "an error" : renderSubtype(envelope.subtype)} for ${label}`,
    );
  }
  if (envelope.result === "") {
    return {
      raw: "",
      invalidReason: `No output for ${label} (subtype=${renderSubtype(envelope.subtype)})`,
    };
  }
  // No native schema enforcement + plan-mode framing ⇒ the model narrates
  // around the JSON ("I'll inspect the workspace…{…}"). Hand the floor the
  // first balanced JSON object as a CANDIDATE, the floor still validates
  // it and falls back to the raw text; extraction is never the mechanism.
  const attempt: FloorAttempt = { raw: envelope.result };
  const candidate = extractJsonCandidate(envelope.result);
  if (candidate !== undefined) attempt.parsed = candidate;
  return attempt;
}

/**
 * LAST parseable balanced top-level JSON object in the text, respecting strings
 * and escapes; undefined when none parses. Last, not first, because the answer
 * follows the narration and a model may echo the schema object before it. The
 * floor still validates the pick. Bounded single pass, no regex.
 */
function extractJsonCandidate(text: string): unknown {
  let candidate: unknown;
  let found = false;
  let start = text.indexOf("{");
  // Span-attempt bound: narration carries a handful of braces; a hostile
  // many-brace flood must not turn the rescan quadratic against the 16M
  // stdout cap. Past the bound the floor's raw path still judges the text.
  let attempts = 0;
  while (start !== -1 && attempts < 32) {
    attempts++;
    const end = findBalancedEnd(text, start);
    if (end === -1) {
      start = text.indexOf("{", start + 1);
      continue;
    }
    try {
      candidate = JSON.parse(text.slice(start, end + 1));
      found = true;
      start = text.indexOf("{", end + 1);
    } catch {
      start = text.indexOf("{", start + 1);
    }
  }
  return found ? candidate : undefined;
}

/** Index of the brace closing the object opened at `start`, or -1. */
function findBalancedEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
    } else if (inString) {
      if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
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

// Boot-probe interpreters: a warn-only headless-contract version floor and the
// auth verdict. Both exist because the CLI's own exits are auth-blind: `about`
// exits 0 while logged out, and the verdict lives in its JSON body.

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
  /** The matched YYYY.MM.DD text, regex-constrained, safe to render. */
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
 * not ability to run. Unparseable output warns too, "could not verify"
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
 * The `about --format json` fields the verdict reads (lenient shape,
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
 * Auth verdict: `about` is exit-blind, so this JSON read IS the preflight. Null
 * identity fields are the positive logged-out signal and refuse boot; output
 * without them warns unverifiable instead, since refusing on a parse gap would
 * brick every pre-floor CLI. The email is PII and never appears in a verdict.
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
