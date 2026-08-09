import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { z } from "zod/v4";
import { GeneratorError, GeneratorErrorKind } from "../contract/errors";
import { parseStructuredText, validationError } from "./jsonSchema";
import { salvageDroppableEnums } from "./enumRecovery";

/** Progress sink — defaults to no-op so callers stay usable in tests. */
type Logger = (message: string) => void;

/**
 * The shared schema-floor pipeline: validate → salvage droppable enum slips
 * → ONE feedback retry → dump-and-throw. Every adapter runs generation
 * through this — native provider enforcement is a bonus layer on top, never
 * the mechanism.
 *
 * The injected `attempt` closure absorbs transport differences: an API
 * adapter turns feedback into an assistant/user message pair on the same
 * conversation; a CLI adapter stitches it into a fresh process's prompt.
 * `attempt` REJECTIONS pass through untouched — aborts are not generation
 * failures, and transport-level errors carry their own classification. Only
 * a resolved attempt whose output fails the schema enters salvage/retry.
 */

/** The failed output + validation error the retry attempt must present to the model. */
export interface FloorFeedback {
  raw: string;
  error: string;
}

/**
 * One transport attempt's outcome. `parsed` is a fast-path CANDIDATE (e.g. a
 * CLI's natively-enforced structured output) — the pipeline still validates
 * it against the schema before returning it; native enforcement is never the
 * mechanism. It is typed `unknown` because it IS untrusted —
 * the schema decides. `invalidReason` lets a transport override the
 * pipeline's parse-error message when it knows better why the output is
 * unusable (e.g. "No structured output (stop_reason=max_tokens)").
 */
export interface FloorAttempt {
  raw: string;
  parsed?: unknown;
  invalidReason?: string;
  /**
   * false when the raw output must not be salvage-eligible — e.g. a
   * truncated/content-filtered stream (finish_reason length/content_filter):
   * a droppable-enum salvage of INCOMPLETE output would return a fragment
   * as a completed generation. The raw still feeds retry feedback/dumps.
   */
  salvageable?: boolean;
}

export interface RunWithSchemaFloorArgs<S extends z.ZodType> {
  schema: S;
  /** Short label for progress logs and dump filenames, e.g. "brief". */
  label: string;
  /** Array fields whose invalid elements may be dropped (warn-and-drop). */
  salvageFields?: readonly string[];
  /** Where failed attempts' raw outputs are dumped for debugging. */
  failureDir: string;
  log?: Logger;
  attempt(feedback: FloorFeedback | undefined): Promise<FloorAttempt>;
}

/**
 * The retry prompt body every transport embeds verbatim (after echoing the
 * failed output its own way), so feedback wording is identical across
 * adapters and pinned by the shared contract suite.
 */
export function schemaFeedbackMessage(error: string): string {
  return (
    `Your previous response failed schema validation:\n${error}\n\n` +
    `Produce the corrected JSON object conforming exactly to the schema. ` +
    `Use ONLY tokens from the closed vocabularies — never invent a token.`
  );
}

/** Disambiguates dump filenames within one process (Date.now can collide). */
let dumpCounter = 0;

/**
 * Persist a failed attempt's raw output so a schema failure is debuggable
 * after the fact (the Zod error alone doesn't show what the model actually
 * emitted). Best-effort — never throws.
 */
function dumpFailure(
  failureDir: string,
  label: string,
  raw: string,
  error: string,
): string | null {
  try {
    mkdirSync(failureDir, { recursive: true });
    const file = join(
      failureDir,
      `${label.replace(/\W+/g, "-")}-${Date.now()}-${dumpCounter++}.failed.json`,
    );
    writeFileSync(file, JSON.stringify({ error, raw }, null, 2));
    return file;
  } catch {
    return null;
  }
}

/** JSON.parse that yields undefined (never throws) on malformed text. */
function tryJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * JSON.stringify that never throws — an untrusted candidate can be cyclic,
 * hold a BigInt, or carry a throwing toJSON; the pipeline must still dump,
 * retry, and classify rather than reject.
 */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    try {
      return String(value);
    } catch {
      // Even primitive coercion can throw (Symbol.toPrimitive).
      return "[unserializable output]";
    }
  }
}

export async function runWithSchemaFloor<S extends z.ZodType>(
  args: RunWithSchemaFloorArgs<S>,
): Promise<z.infer<S>> {
  const log = args.log ?? (() => {});
  let feedback: FloorFeedback | undefined;

  for (let attempt = 0; ; attempt++) {
    // Sequential by design: the retry needs the failed attempt's output.
    // eslint-disable-next-line no-await-in-loop
    const outcome = await args.attempt(feedback);
    const raw = outcome.raw;
    let parseError: unknown;

    if (outcome.invalidReason !== undefined) {
      parseError = new Error(outcome.invalidReason);
    } else if (outcome.parsed !== undefined) {
      // Candidate first — the floor is the enforcement mechanism, so a
      // transport-parsed value is validated like any other.
      const checked = args.schema.safeParse(outcome.parsed);
      if (checked.success) return checked.data;
      // Fall back to raw when it validates independently; otherwise keep
      // the CANDIDATE's validation errors (raw may be an envelope whose
      // JSON.parse failure would drown the real issues).
      if (raw !== "") {
        try {
          return parseStructuredText(args.schema, raw);
        } catch {
          // Keep the candidate's error below.
        }
      }
      parseError = validationError(checked.error);
    } else {
      try {
        return parseStructuredText(args.schema, raw);
      } catch (error) {
        parseError = error;
      }
    }

    // What the model actually produced, for dump/feedback: raw when the
    // transport gave one, else the serialized candidate.
    const effectiveRaw =
      raw !== ""
        ? raw
        : outcome.parsed !== undefined
          ? safeStringify(outcome.parsed)
          : "";

    // Salvage prefers the transport's parsed candidate (its raw may be an
    // envelope or decorated form that no longer JSON-parses to the payload)
    // and runs whenever EITHER surface carries output.
    const salvageInput =
      outcome.parsed !== undefined ? outcome.parsed : tryJsonParse(raw);
    const salvaged =
      (outcome.parsed !== undefined || raw !== "") &&
      args.salvageFields?.length &&
      outcome.salvageable !== false
        ? salvageDroppableEnums(
            salvageInput,
            args.schema,
            new Set(args.salvageFields),
          )
        : null;
    if (salvaged) {
      log(`⚠ salvaged ${args.label}: ${salvaged.issues.join("; ")}`);
      return salvaged.value;
    }

    const errorMessage =
      parseError instanceof Error ? parseError.message : String(parseError);
    const dumpPath = dumpFailure(
      args.failureDir,
      args.label,
      effectiveRaw,
      errorMessage,
    );
    const dumpNote = dumpPath ? ` (raw output saved to ${dumpPath})` : "";

    if (attempt === 0 && effectiveRaw !== "") {
      log(
        `⚠ ${args.label} failed schema validation — retrying once with error feedback${dumpNote}`,
      );
      feedback = { raw: effectiveRaw, error: errorMessage };
      continue;
    }

    throw new GeneratorError(
      GeneratorErrorKind.SCHEMA_FLOOR,
      `${errorMessage}${dumpNote}`,
      { cause: parseError },
    );
  }
}
