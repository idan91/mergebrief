import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { z } from "zod/v4";
import { GeneratorError, GeneratorErrorKinds } from "../contract/errors";
import {
  GeneratorWarningKinds,
  type GeneratorWarningSink,
} from "../contract/types";
import { parseStructuredText, validationError } from "./jsonSchema";
import { salvageDroppableEnums } from "./enumRecovery";

/** Progress sink, defaults to no-op so callers stay usable in tests. */
type Logger = (message: string) => void;

/**
 * The schema floor every adapter runs generation through: validate, salvage
 * droppable enum slips, ONE feedback retry, then dump and throw. Native
 * provider enforcement is a bonus layer, never the mechanism. `attempt`
 * rejections pass through untouched; only a resolved attempt enters salvage.
 */

/** The failed output + validation error the retry attempt must present to the model. */
export interface FloorFeedback {
  raw: string;
  error: string;
}

/**
 * One transport attempt's outcome. `parsed` is an untrusted CANDIDATE, typed
 * `unknown` because the schema decides; the pipeline validates it even when a
 * CLI enforced structure natively. `invalidReason` lets a transport override
 * the parse-error message when it knows why the output is unusable.
 */
export interface FloorAttempt {
  raw: string;
  parsed?: unknown;
  invalidReason?: string;
  /**
   * false when the raw output must not be salvage-eligible, e.g. a
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
  onWarning?: GeneratorWarningSink;
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
 * emitted). Best-effort, never throws.
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
 * JSON.stringify that never throws, an untrusted candidate can be cyclic,
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

function deriveEffectiveRaw(raw: string, parsed: unknown): string {
  if (raw !== "") return raw;
  if (parsed !== undefined) return safeStringify(parsed);
  return "";
}

type RawParse<S extends z.ZodType> =
  | { readonly ok: true; readonly value: z.infer<S> }
  | { readonly ok: false };

/** Raw output against the schema; empty raw or any parse failure is a refusal. */
function tryParseStructuredText<S extends z.ZodType>(
  schema: S,
  raw: string,
): RawParse<S> {
  if (raw === "") return { ok: false };
  try {
    return { ok: true, value: parseStructuredText(schema, raw) };
  } catch {
    return { ok: false };
  }
}

export async function runWithSchemaFloor<S extends z.ZodType>(
  args: RunWithSchemaFloorArgs<S>,
): Promise<z.infer<S>> {
  const log = args.log ?? (() => {});
  let feedback: FloorFeedback | undefined;

  for (let attempt = 0; ; attempt++) {
    // Sequential by design: the retry needs the failed attempt's output.
    // oxlint-disable-next-line no-await-in-loop
    const outcome = await args.attempt(feedback);
    const raw = outcome.raw;
    let parseError: unknown;

    if (outcome.invalidReason !== undefined) {
      parseError = new Error(outcome.invalidReason);
    } else if (outcome.parsed !== undefined) {
      // Candidate first, the floor is the enforcement mechanism, so a
      // transport-parsed value is validated like any other.
      const checked = args.schema.safeParse(outcome.parsed);
      if (checked.success) return checked.data;
      // Fall back to raw when it validates independently; otherwise keep
      // the CANDIDATE's validation errors (raw may be an envelope whose
      // JSON.parse failure would drown the real issues).
      const rawParse = tryParseStructuredText(args.schema, raw);
      if (rawParse.ok) return rawParse.value;
      parseError = validationError(checked.error);
    } else {
      try {
        return parseStructuredText(args.schema, raw);
      } catch (error) {
        parseError = error;
      }
    }

    const effectiveRaw = deriveEffectiveRaw(raw, outcome.parsed);

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
      const salvageMessage = `⚠ salvaged ${args.label}: ${salvaged.issues.join("; ")}`;
      log(salvageMessage);
      args.onWarning?.({
        kind: GeneratorWarningKinds.SALVAGED,
        message: salvageMessage,
      });
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
      const retryMessage = `⚠ ${args.label} failed schema validation — retrying once with error feedback`;
      log(`${retryMessage}${dumpNote}`);
      args.onWarning?.({
        kind: GeneratorWarningKinds.FEEDBACK_RETRY,
        message: retryMessage,
      });
      feedback = { raw: effectiveRaw, error: errorMessage };
      continue;
    }

    throw new GeneratorError(
      GeneratorErrorKinds.SCHEMA_FLOOR,
      `${errorMessage}${dumpNote}`,
      { cause: parseError },
    );
  }
}
