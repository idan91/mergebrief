import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Result } from "types/utils";

import {
  FRONT_MATTER_FENCE,
  NOTES_EXTENSION,
  UPGRADE_HEADING,
} from "../consts";
import { type FrontMatter, FrontMatterSchema } from "../schemas";
import type { NotesError, ReleaseNotes, ReleaseVersion } from "../types";
import { compareReleaseVersions, parseReleaseVersion } from "./version";

const FILENAME_REASON = `filename is not <X.Y.Z>${NOTES_EXTENSION} or <X.Y.Z-rc.N>${NOTES_EXTENSION}`;
const FENCE_REASON = `front matter must open with ${FRONT_MATTER_FENCE} on the first line and close with ${FRONT_MATTER_FENCE}`;
const EMPTY_BODY_REASON = "the notes body is empty";
const LEADING_BLANK_LINES = /^\n+/;
const UPGRADE_REASON = `a breaking release needs an \`${UPGRADE_HEADING}\` section listing the extra steps`;

interface SplitNotes {
  readonly frontMatter: FrontMatter;
  readonly body: string;
}

/** Every notes file in `dir`, newest first; every bad file in one list. */
export function readReleaseNotes(
  dir: string,
): Result<readonly ReleaseNotes[], readonly NotesError[]> {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, error: [{ path: dir, reason }] };
  }

  const notes: ReleaseNotes[] = [];
  const errors: NotesError[] = [];
  for (const name of names.toSorted()) {
    const path = join(dir, name);
    const parsed = readOneNotesFile(path);
    if (parsed.ok) {
      notes.push(parsed.value);
    } else {
      errors.push(parsed.error);
    }
  }

  if (errors.length > 0) {
    return { ok: false, error: errors };
  }
  const newestFirst = notes.toSorted((left, right) =>
    compareReleaseVersions(right.version, left.version),
  );
  return { ok: true, value: newestFirst };
}

function readOneNotesFile(path: string): Result<ReleaseNotes, NotesError> {
  return parseReleaseNotes(path, readFileSync(path, "utf8"));
}

/** One notes file's text as it would parse at `path`; nothing is read. */
export function parseReleaseNotes(
  path: string,
  text: string,
): Result<ReleaseNotes, NotesError> {
  const version = parseVersionFromFilename(path);
  if (version === undefined) {
    return { ok: false, error: { path, reason: FILENAME_REASON } };
  }

  const split = splitFrontMatter(text);
  if (!split.ok) {
    return { ok: false, error: { path, reason: split.error } };
  }
  const { frontMatter, body } = split.value;

  const bodyEmpty = body.trim().length === 0;
  if (bodyEmpty) {
    return { ok: false, error: { path, reason: EMPTY_BODY_REASON } };
  }
  const upgradeMissing = frontMatter.breaking && !hasUpgradeSection(body);
  if (upgradeMissing) {
    return { ok: false, error: { path, reason: UPGRADE_REASON } };
  }

  return {
    ok: true,
    value: {
      version,
      date: frontMatter.date,
      breaking: frontMatter.breaking,
      security: frontMatter.security,
      body,
      path,
    },
  };
}

function parseVersionFromFilename(path: string): ReleaseVersion | undefined {
  const name = basename(path);
  const hasNotesExtension = name.endsWith(NOTES_EXTENSION);
  if (!hasNotesExtension) {
    return undefined;
  }
  const stem = name.slice(0, -NOTES_EXTENSION.length);
  const hasTagPrefix = stem.startsWith("v");
  if (hasTagPrefix) {
    return undefined;
  }
  return parseReleaseVersion(stem);
}

/** The fenced `key: value` lines and the body after the closing fence. */
function splitFrontMatter(text: string): Result<SplitNotes, string> {
  const lines = text.split("\n");
  if (lines[0] !== FRONT_MATTER_FENCE) {
    return { ok: false, error: FENCE_REASON };
  }
  const closing = lines.indexOf(FRONT_MATTER_FENCE, 1);
  if (closing === -1) {
    return { ok: false, error: FENCE_REASON };
  }

  const raw: Record<string, string | boolean> = {};
  for (const line of lines.slice(1, closing)) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      return {
        ok: false,
        error: `front matter line is not key: value: ${line}`,
      };
    }
    const key = line.slice(0, separator);
    const indented = key !== key.trim();
    if (indented) {
      return { ok: false, error: `front matter key is indented: ${line}` };
    }
    const repeated = Object.hasOwn(raw, key);
    if (repeated) {
      return { ok: false, error: `front matter key repeats: ${key}` };
    }
    raw[key] = parseScalar(line.slice(separator + 1).trim());
  }

  const parsed = FrontMatterSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join(".") ?? "front matter";
    return { ok: false, error: `${field}: ${issue?.message ?? "invalid"}` };
  }
  return {
    ok: true,
    value: {
      frontMatter: parsed.data,
      body: lines
        .slice(closing + 1)
        .join("\n")
        .replace(LEADING_BLANK_LINES, ""),
    },
  };
}

function parseScalar(value: string): string | boolean {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return value;
}

function hasUpgradeSection(body: string): boolean {
  const found = body
    .split("\n")
    .some((line) => line.trim() === UPGRADE_HEADING);
  return found;
}
