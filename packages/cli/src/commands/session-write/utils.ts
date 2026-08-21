// Payload assembly — convenience flags XOR `-F`, one builder per command.
// Builders return `unknown` because the `-F` arm IS unknown: the payload is
// the user's bytes, relayed for the server to validate. Only the flag arm
// has a shape the CLI knows (`FlagAnchor`).
import { CliError, ExitCode } from "../../exit";
import type {
  AnchorFlags,
  CreateDraftInput,
  FlagAnchor,
  ReanchorInput,
  UpdateDraftInput,
} from "./types";

const EXCLUSIVE =
  "-F and the convenience flags are mutually exclusive — send the whole payload one way";

function parseLine(flag: string, raw: string): number {
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new CliError(
      ExitCode.USAGE,
      `${flag} must be a positive integer, got "${raw}"`,
    );
  }
  return Number(raw);
}

/**
 * The anchor coordinates a flag form carries; `--side` defaults to `new`
 * (comments land on the added lines unless you say otherwise). Absent flags
 * stay absent — the server's schema is the validator (exit 5), not this.
 */
function anchorFromFlags(flags: AnchorFlags): FlagAnchor {
  const anchor: FlagAnchor = { side: flags.side ?? "new" };
  if (flags.file !== undefined) {
    anchor.filePath = flags.file;
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
  return [flags.file, flags.side, flags.start, flags.end].some(
    (flag) => flag !== undefined,
  );
}

export function buildCreateDraftPayload(input: CreateDraftInput): unknown {
  const hasFlags = hasAnchorFlags(input) || input.body !== undefined;
  if (input.payload !== undefined && hasFlags) {
    throw new CliError(ExitCode.USAGE, EXCLUSIVE);
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
    throw new CliError(ExitCode.USAGE, EXCLUSIVE);
  }
  if (input.payload !== undefined) {
    return input.payload;
  }
  return input.body === undefined ? {} : { body: input.body };
}

export function buildReanchorPayload(input: ReanchorInput): unknown {
  if (input.payload !== undefined && hasAnchorFlags(input)) {
    throw new CliError(ExitCode.USAGE, EXCLUSIVE);
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
 * A risk operation's payload: `-F` is REQUIRED — the flags array names its
 * anchors verbatim from `session --json`, which no flag form can carry.
 * `dismiss` takes a `--reason` convenience, refused when the payload already
 * carries one (a defined precedence beats a silent overwrite).
 */
export function buildRiskPayload(
  payload: unknown,
  reason?: string,
): unknown {
  if (payload === undefined) {
    throw new CliError(
      ExitCode.USAGE,
      "-F is required — risk operations take a JSON payload with the flags array (anchors copy through from `session --json`)",
    );
  }
  if (reason === undefined) {
    return payload;
  }
  // Merging --reason needs a JSON object to merge into; anything else would
  // put bytes on the wire the user never wrote.
  if (!isRecord(payload) || Array.isArray(payload)) {
    throw new CliError(
      ExitCode.USAGE,
      "--reason needs a JSON object payload to merge into — send {\"flags\":[…]} (or put reason in the payload)",
    );
  }
  if (payload["reason"] !== undefined) {
    throw new CliError(
      ExitCode.USAGE,
      "--reason and a reason in the -F payload are mutually exclusive — provide it once",
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
      ExitCode.USAGE,
      "--read and --unread are mutually exclusive",
    );
  }
  return unread !== true;
}
