// Payload assembly: convenience flags XOR `-F`, one builder per command.
// Builders return `unknown` because the `-F` arm IS unknown: the payload is
// the user's bytes, relayed for the server to validate. Only the flag arm
// has a shape the CLI knows (`FlagAnchor`).
import { CommentAnchorKinds } from "types/comments";
import { CliError, ExitCodes } from "../../exit";
import type {
  AnchorFlags,
  CreateDraftInput,
  FileFlagAnchor,
  FlagAnchor,
  LineFlagAnchor,
  ReanchorInput,
  UpdateDraftInput,
} from "./types";

const EXCLUSIVE =
  "-F and the convenience flags are mutually exclusive: send the whole payload one way";

const FILE_PARTIAL_SPAN =
  "--file with only one of --start/--end is not a File comment; pass both for a Line comment, or neither for a File comment";

const FILE_LINE_FLAGS =
  "--file without --start/--end cannot take --side or --start-side";

function parseLine(flag: string, raw: string): number {
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new CliError(
      ExitCodes.USAGE,
      `${flag} must be a positive integer, got "${raw}"`,
    );
  }
  return Number(raw);
}

function isFileFlagForm(flags: AnchorFlags): boolean {
  return (
    flags.file !== undefined &&
    flags.start === undefined &&
    flags.end === undefined
  );
}

function hasPartialSpan(flags: AnchorFlags): boolean {
  const hasStart = flags.start !== undefined;
  const hasEnd = flags.end !== undefined;
  return hasStart !== hasEnd;
}

/**
 * The anchor coordinates a flag form carries. `--file` with no span is a
 * File comment. `--side` defaults to `new` on the line arm only. Absent line
 * flags stay absent: the server's schema is the validator (exit 5), not this.
 */
function anchorFromFlags(flags: AnchorFlags): FlagAnchor {
  const filePath = flags.file;
  if (filePath !== undefined && hasPartialSpan(flags)) {
    throw new CliError(ExitCodes.USAGE, FILE_PARTIAL_SPAN);
  }
  if (filePath !== undefined && isFileFlagForm(flags)) {
    if (flags.side !== undefined || flags.startSide !== undefined) {
      throw new CliError(ExitCodes.USAGE, FILE_LINE_FLAGS);
    }
    const anchor: FileFlagAnchor = {
      kind: CommentAnchorKinds.FILE,
      filePath,
    };
    return anchor;
  }
  const anchor: LineFlagAnchor = { side: flags.side ?? "new" };
  if (flags.file !== undefined) {
    anchor.filePath = flags.file;
  }
  if (flags.startSide !== undefined) {
    anchor.startSide = flags.startSide;
  }
  if (flags.start !== undefined) {
    anchor.startLine = parseLine("--start", flags.start);
  }
  if (flags.end !== undefined) {
    anchor.endLine = parseLine("--end", flags.end);
  }
  return anchor;
}

function hasAnchorFlags(flags: AnchorFlags): boolean {
  return [flags.file, flags.side, flags.startSide, flags.start, flags.end].some(
    (flag) => flag !== undefined,
  );
}

export function buildCreateDraftPayload(input: CreateDraftInput): unknown {
  const hasFlags = hasAnchorFlags(input) || input.body !== undefined;
  if (input.payload !== undefined && hasFlags) {
    throw new CliError(ExitCodes.USAGE, EXCLUSIVE);
  }
  if (input.payload !== undefined) {
    return input.payload;
  }
  const payload = anchorFromFlags(input);
  if (input.body !== undefined) {
    payload.body = input.body;
  }
  return payload;
}

export function buildUpdateDraftPayload(input: UpdateDraftInput): unknown {
  if (input.payload !== undefined && input.body !== undefined) {
    throw new CliError(ExitCodes.USAGE, EXCLUSIVE);
  }
  if (input.payload !== undefined) {
    return input.payload;
  }
  return input.body === undefined ? {} : { body: input.body };
}

export function buildReanchorPayload(input: ReanchorInput): unknown {
  if (input.payload !== undefined && hasAnchorFlags(input)) {
    throw new CliError(ExitCodes.USAGE, EXCLUSIVE);
  }
  if (input.payload !== undefined) {
    return input.payload;
  }
  return anchorFromFlags(input);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * A risk operation's payload: `-F` is REQUIRED. The flags array names its
 * anchors verbatim from `session --json`, which no flag form can carry.
 * `dismiss` takes a `--reason` convenience, refused when the payload already
 * carries one (a defined precedence beats a silent overwrite).
 */
export function buildRiskPayload(payload: unknown, reason?: string): unknown {
  if (payload === undefined) {
    throw new CliError(
      ExitCodes.USAGE,
      "-F is required: risk operations take a JSON payload with the flags array (anchors copy through from `session --json`)",
    );
  }
  if (reason === undefined) {
    return payload;
  }
  // Merging --reason needs a JSON object to merge into; anything else would
  // put bytes on the wire the user never wrote.
  if (!isRecord(payload) || Array.isArray(payload)) {
    throw new CliError(
      ExitCodes.USAGE,
      '--reason needs a JSON object payload to merge into: send {"flags":[…]} (or put reason in the payload)',
    );
  }
  if (payload["reason"] !== undefined) {
    throw new CliError(
      ExitCodes.USAGE,
      "--reason and a reason in the -F payload are mutually exclusive: provide it once",
    );
  }
  return { ...payload, reason };
}

/** `chunk-read`'s boolean: `--read` (the default) XOR `--unread`. */
export function resolveReadFlag(
  read: boolean | undefined,
  unread: boolean | undefined,
): boolean {
  if (read === true && unread === true) {
    throw new CliError(
      ExitCodes.USAGE,
      "--read and --unread are mutually exclusive",
    );
  }
  return unread !== true;
}
