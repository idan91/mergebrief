import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { z } from "zod/v4";
import { GeneratorError, GeneratorErrorKind } from "./errors";
import { runWithSchemaFloor, schemaFeedbackMessage } from "./floor";
import type { GenerateRequest, Generator } from "./generator";
import {
  harnessTimeoutError,
  resolveHarnessTimeouts,
  runHarnessProcess,
  type HarnessRunResult,
  type HarnessTimeoutOverrides,
  type HarnessTimeouts,
} from "./harness";
import { enumPreservingJsonSchema } from "./outputFormat";
import type { Effort, Generation } from "./vocabulary";

/**
 * Codex CLI adapter (ADR 0030): one `codex exec --json` process per attempt,
 * JSONL events on stdout, prompt via stdin.
 *
 * Invariants (audited against every path below):
 * 1. The schema floor is hard — `--output-schema` is strict-decoding-level
 *    enforcement with UNVERIFIED edges (capabilities note §2); every answer
 *    still runs `runWithSchemaFloor`. The answer is the LAST completed
 *    `agent_message`, whose `text` is a JSON *string* — the floor's parse
 *    is the documented second parse of the double-parse quirk.
 * 2. Abort rejections propagate UNTOUCHED (ADR 0006 #6).
 * 3. Provenance is honest within the static declaration: no JSONL event
 *    carries a model id and ModelRerouted has no JSONL counterpart, so a
 *    silent reroute is UNOBSERVABLE here (the documented blind spot —
 *    upgrading to verification waits on the CLI's JSONL gaining a model
 *    event). `model` stamps the configured id, or "codex-default" when the
 *    CLI's own configured default runs. Effort maps to
 *    `model_reasoning_effort` — the knob exists, so it IS echoed.
 * 4. No secrets in errors: turn.failed/error carry free-form message
 *    strings (auth expiry, rate limits and refusals are NOT discriminated
 *    by type) — those strings are untrusted and are NEVER interpolated
 *    into GeneratorError messages; classification stays opaque with fixed
 *    text, and the full detail lives in local failure dumps only.
 * 5. Lockdown profile: `--sandbox read-only --skip-git-repo-check
 *    --ephemeral` — generation must neither write nor persist sessions.
 */

const CODEX_DEFAULT_MODEL_TOKEN = "codex-default";

export interface CodexGeneratorOptions {
  /** Binary path or name (PATH-resolved by spawn). */
  command: string;
  /** Model id for -m; absent → the CLI's configured default runs. */
  model?: string | undefined;
  failureDir: string;
  timeouts?: HarnessTimeoutOverrides | undefined;
  /** Spawn env; defaults to process.env (the CLI needs HOME/auth.json). */
  env?: Record<string, string | undefined> | undefined;
}

export class CodexGenerator implements Generator {
  private readonly command: string;
  private readonly model: string | undefined;
  private readonly failureDir: string;
  private readonly timeouts: HarnessTimeouts;
  private readonly env: Record<string, string | undefined> | undefined;

  constructor(options: CodexGeneratorOptions) {
    this.command = options.command;
    this.model = options.model;
    this.failureDir = options.failureDir;
    this.timeouts = resolveHarnessTimeouts(options.timeouts);
    this.env = options.env;
  }

  provenance(effort: Effort): Generation {
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

    // The schema travels by file (--output-schema takes a PATH); one temp
    // dir per generate() covers both attempts, removed best-effort below.
    const workDir = mkdtempSync(join(tmpdir(), "codex-gen-"));
    const schemaFile = join(workDir, "output-schema.json");

    try {
      writeFileSync(schemaFile, JSON.stringify(wireSchema), { mode: 0o600 });
      return await runWithSchemaFloor({
        schema: req.schema,
        label: req.label,
        ...(req.salvageFields ? { salvageFields: req.salvageFields } : {}),
        failureDir: this.failureDir,
        log,
        attempt: async (feedback) => {
          // Stateless CLI: the feedback retry is a fresh process; system,
          // failed output and validation errors stitch into one stdin
          // prompt (codex exec has no separate system-prompt channel).
          const prompt = feedback
            ? `${req.system}\n\n${req.user}\n\n[Your previous response]\n${feedback.raw}\n\n${schemaFeedbackMessage(feedback.error)}`
            : `${req.system}\n\n${req.user}`;
          log(`${feedback ? "retrying" : "generating"} ${req.label} via ${this.command}…`);
          const run = await runHarnessProcess({
            command: this.command,
            argv: [
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
              ...(this.model !== undefined ? ["--model", this.model] : []),
            ],
            stdin: prompt,
            timeouts: this.timeouts,
            ...(this.env ? { env: this.env } : {}),
            ...(req.signal ? { signal: req.signal } : {}),
            log,
          });
          return interpretCodexRun(this.command, req.label, run);
        },
      });
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

/** Map one finished codex run onto a floor attempt or a classified throw. */
function interpretCodexRun(
  command: string,
  label: string,
  run: HarnessRunResult,
): { raw: string; invalidReason?: string } {
  if (run.timedOut) {
    throw harnessTimeoutError(label, run);
  }

  let lastAnswer: string | null = null;
  let sawFailureEvent = false;
  for (const line of run.stdout.split("\n")) {
    const event = parseCodexLine(line);
    if (event === null) continue;
    if (event.kind === "agent-message") {
      // LAST completed agent_message wins — earlier ones are narration.
      lastAnswer = event.text;
    } else {
      sawFailureEvent = true;
    }
  }

  if (run.exitCode !== 0 || lastAnswer === null || sawFailureEvent) {
    // turn.failed / error messages are free-form, undiscriminated strings
    // (auth, rate limits and refusals all arrive this way) and untrusted —
    // classification stays opaque with FIXED text; detail goes to dumps.
    // A fatal in-band event voids any answer even on a drifted exit 0: the
    // real CLI sets error_seen and exits 1, so 0 + turn.failed is a CLI we
    // no longer understand.
    const what =
      run.exitCode !== 0
        ? `failed (code ${run.exitCode ?? `signal ${run.exitSignal ?? "unknown"}`})`
        : lastAnswer === null
          ? "exited without an agent answer"
          : "produced an answer alongside a fatal event (drifted CLI)";
    throw new GeneratorError(
      GeneratorErrorKind.OPAQUE,
      `${command} ${what} for ${label}${sawFailureEvent ? " after an in-band error event" : ""}`,
    );
  }

  if (lastAnswer === "") {
    return { raw: "", invalidReason: `Empty agent answer for ${label}` };
  }
  // The answer text is a JSON string of the payload (double-parse quirk):
  // hand it to the floor raw — its parse IS the second parse.
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
    // Non-string text is envelope drift, not an answer — it must neither
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
