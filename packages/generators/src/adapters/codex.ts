import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { z } from "zod/v4";
import { GeneratorError, GeneratorErrorKinds } from "../contract/errors";
import {
  runWithSchemaFloor,
  schemaFeedbackMessage,
  type RunWithSchemaFloorArgs,
} from "../validation/enforceSchema";
import type { GenerateRequest, Generator } from "../contract/generator";
import { harnessTimeoutError } from "../harness/redact";
import {
  resolveHarnessTimeouts,
  runHarnessProcess,
  type HarnessRunArgs,
  type HarnessRunResult,
  type HarnessTimeoutOverrides,
  type HarnessTimeouts,
} from "../harness/run";
import { enumPreservingJsonSchema } from "../validation/jsonSchema";
import {
  stripInjectedNulls,
  withAllRequired,
} from "../validation/openaiStrict";
import type { Effort, Generation } from "../contract/generation";

/* oxlint-disable house/comment-run -- five adapter invariants, one of them the
   no-secrets-in-errors rule, decide whether a change here is safe */
/**
 * Codex CLI adapter: one `codex exec --json` process per attempt, JSONL
 * events on stdout, prompt via stdin.
 *
 * Invariants:
 * 1. The schema floor is hard, `--output-schema` is strict-decoding-level
 *    enforcement with UNVERIFIED edges; every answer still runs
 *    `runWithSchemaFloor`. The answer is the LAST completed `agent_message`,
 *    whose `text` is a JSON *string*, the floor's parse is the second parse
 *    of the double-parse quirk.
 * 2. Abort rejections propagate UNTOUCHED.
 * 3. Origin is honest within the static declaration: no JSONL event
 *    carries a model id and ModelRerouted has no JSONL counterpart, so a
 *    silent reroute is UNOBSERVABLE here, verification waits on the CLI's
 *    JSONL gaining a model event. `model` stamps the configured id, or
 *    "codex-default" when the
 *    CLI's own configured default runs. Effort maps to
 *    `model_reasoning_effort`, the knob exists, so it IS echoed.
 * 4. No secrets in errors: turn.failed/error carry free-form message
 *    strings (auth expiry, rate limits and refusals are NOT discriminated
 *    by type), those strings are untrusted and are NEVER interpolated
 *    into GeneratorError messages; classification stays opaque with fixed
 *    text, and the full detail lives in local failure dumps only.
 * 5. Lockdown profile: `--sandbox read-only --skip-git-repo-check
 *    --ephemeral`, generation must neither write nor persist sessions.
 */
/* oxlint-enable house/comment-run */

const CODEX_DEFAULT_MODEL_TOKEN = "codex-default";

export interface CodexGeneratorOptions {
  /** Binary path or name (PATH-resolved by spawn). */
  command: string;
  /** Model id for -m; absent → the CLI's configured default runs. */
  model?: string | undefined;
  failureDir: string;
  timeouts?: HarnessTimeoutOverrides | undefined;
  /** Spawn env, from the composition root (the CLI needs HOME for its login). */
  env: Record<string, string | undefined>;
}

export class CodexGenerator implements Generator {
  private readonly command: string;
  private readonly model: string | undefined;
  private readonly failureDir: string;
  private readonly timeouts: HarnessTimeouts;
  private readonly env: Record<string, string | undefined>;

  constructor(options: CodexGeneratorOptions) {
    this.command = options.command;
    this.model = options.model;
    this.failureDir = options.failureDir;
    this.timeouts = resolveHarnessTimeouts(options.timeouts);
    this.env = options.env;
  }

  origin(effort: Effort): Generation {
    return {
      provider: "codex",
      model: this.model ?? CODEX_DEFAULT_MODEL_TOKEN,
      effort,
    };
  }

  async generate<S extends z.ZodType>(
    req: GenerateRequest<S>,
  ): Promise<z.infer<S>> {
    const log = req.log ?? (() => {});

    let wireSchema: Record<string, unknown>;
    let codexWireSchema: Record<string, unknown>;
    try {
      wireSchema = enumPreservingJsonSchema(req.schema);
      // The CLI forwards --output-schema to an OpenAI-lineage backend, whose
      // strict mode rejects optional properties ("'required' ... must include
      // every key in properties"), send the all-required null-union variant
      // and strip the stand-in nulls back out below (same shim as openaiCore).
      codexWireSchema = withAllRequired(wireSchema);
    } catch (error) {
      throw new GeneratorError(
        GeneratorErrorKinds.CONFIG,
        `schema for ${req.label} is not representable as a strict JSON schema: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
        { cause: error },
      );
    }

    // The schema travels by file (--output-schema takes a PATH); one temp
    // dir per generate() covers both attempts, removed best-effort below.
    const workDir = mkdtempSync(join(tmpdir(), "codex-gen-"));
    const schemaFile = join(workDir, "output-schema.json");

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
          "exec",
          "--json",
          "--sandbox",
          "read-only",
          "--skip-git-repo-check",
          "--ephemeral",
          "--output-schema",
          schemaFile,
          "-c",
          `model_reasoning_effort=${req.effort}`,
        ];
        if (this.model !== undefined) {
          argv.push("--model", this.model);
        }
        const runArgs: HarnessRunArgs = {
          env: this.env,
          command: this.command,
          argv,
          stdin: prompt,
          timeouts: this.timeouts,
          log,
        };
        if (req.signal) runArgs.signal = req.signal;
        const run = await runHarnessProcess(runArgs);
        return interpretCodexRun(this.command, req.label, run, wireSchema);
      },
    };
    if (req.salvageFields) floorArgs.salvageFields = req.salvageFields;

    try {
      writeFileSync(schemaFile, JSON.stringify(codexWireSchema), {
        mode: 0o600,
      });
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

function describeCodexFailure(
  run: HarnessRunResult,
  lastAnswer: string | null,
): string {
  if (run.exitCode !== 0) {
    const exitDetail = run.exitCode ?? `signal ${run.exitSignal ?? "unknown"}`;
    return `failed (code ${exitDetail})`;
  }
  if (lastAnswer === null) return "exited without an agent answer";
  return "produced an answer alongside a fatal event (drifted CLI)";
}

/** Map one finished codex run onto a floor attempt or a classified throw. */
function interpretCodexRun(
  command: string,
  label: string,
  run: HarnessRunResult,
  /** ORIGINAL (pre-`withAllRequired`) wire schema, drives the null strip. */
  wireSchema: Record<string, unknown>,
): { raw: string; invalidReason?: string; parsed?: unknown } {
  if (run.timedOut) {
    throw harnessTimeoutError(label, run);
  }

  let lastAnswer: string | null = null;
  let sawFailureEvent = false;
  for (const line of run.stdout.split("\n")) {
    const event = parseCodexLine(line);
    if (event === null) continue;
    if (event.kind === "agent-message") {
      // LAST completed agent_message wins, earlier ones are narration.
      lastAnswer = event.text;
    } else {
      sawFailureEvent = true;
    }
  }

  if (run.exitCode !== 0 || lastAnswer === null || sawFailureEvent) {
    // turn.failed messages are free-form untrusted strings, so classification
    // stays opaque with FIXED text and detail goes to dumps. A fatal in-band
    // event voids any answer even on exit 0: the real CLI exits 1, so a 0 with
    // turn.failed is a CLI we no longer understand.
    const what = describeCodexFailure(run, lastAnswer);
    throw new GeneratorError(
      GeneratorErrorKinds.OPAQUE,
      `${command} ${what} for ${label}${sawFailureEvent ? " after an in-band error event" : ""}`,
    );
  }

  if (lastAnswer === "") {
    return { raw: "", invalidReason: `Empty agent answer for ${label}` };
  }
  // The answer text is a JSON string of the payload, the double-parse quirk.
  // The null-union wire schema lets a compliant model emit null where the
  // domain schema says absent, so hand the floor a stripped candidate. Malformed
  // JSON falls back to raw so the floor reports the parse error itself.
  let candidate: unknown;
  try {
    candidate = JSON.parse(lastAnswer);
  } catch {
    candidate = undefined;
  }
  if (candidate !== undefined) {
    return {
      raw: lastAnswer,
      parsed: stripInjectedNulls(wireSchema, candidate),
    };
  }
  return { raw: lastAnswer };
}

/** One parsed JSONL line, narrowed to what the adapter reads. */
type CodexEvent = { kind: "agent-message"; text: string } | { kind: "failure" };

function parseCodexLine(line: string): CodexEvent | null {
  if (line.trim() === "") return null;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null; // Non-JSON noise is not ours to interpret.
  }
  if (typeof value !== "object" || value === null) return null;
  const type = Reflect.get(value, "type");
  if (type === "item.completed") {
    const item: unknown = Reflect.get(value, "item");
    if (typeof item !== "object" || item === null) return null;
    if (Reflect.get(item, "type") !== "agent_message") return null;
    const text = Reflect.get(item, "text");
    // Non-string text is envelope drift, not an answer, it must neither
    // overwrite an earlier valid answer nor masquerade as an empty one.
    if (typeof text !== "string") return null;
    return { kind: "agent-message", text };
  }
  if (type === "turn.failed" || type === "error") {
    return { kind: "failure" };
  }
  return null;
}

/** Boot-probe wiring shared with the registry entry. */
export const CODEX_PROBE = {
  versionArgv: ["--version"],
  authArgv: ["login", "status"],
  authFailureHint:
    "run `codex login` interactively (or `codex login --device-auth` headless)",
} as const;
