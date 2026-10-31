import { resolveChunkForLine } from "@web/features/review/utils";
import { DiffLineKinds, DiffSides, type DiffSide } from "types";
import { type DiffLine } from "@web/utils/diffTokens/types";

import {
  GuestHostPrefixes,
  type GuestRowReason,
  GuestRowReasons,
} from "../../model/types";
import type { FileLineOwners } from "../../model/utils/line-owner";

/** The owner's own row a guest row came from, when it came from the owner's diff. */
export interface GuestRowOrigin {
  chunkId: string;
  index: number;
}

/** What a guest table needs to resolve every one of its rows. */
export interface GuestRowsInput {
  file: string;
  /**
   * The PR base to head rows of the file: empty when the PR diff carries
   * none for it, absent while the PR diff itself is not available.
   */
  fileRows: readonly DiffLine[] | undefined;
  /** The full brief's chunks of the file; absent when none touches it. */
  owners: FileLineOwners | undefined;
  originOf?: ((index: number) => GuestRowOrigin | undefined) | undefined;
}

export interface CommentableGuestRow {
  commentable: true;
  chunkId: string;
  side: DiffSide;
  line: number;
}

export interface InertGuestRow {
  commentable: false;
  reason: GuestRowReason;
}

export type GuestRowResolution = CommentableGuestRow | InertGuestRow;

const NEW_SIDE: DiffSide = DiffSides.NEW;

function refuse(reason: GuestRowReason): InertGuestRow {
  return { commentable: false, reason };
}

/** The new-side lines of the PR diff GitHub can hold a comment on: added or context, inside a hunk. */
export function collectPrLines(
  fileRows: readonly DiffLine[] | undefined,
): ReadonlySet<number> {
  const lines = new Set<number>();
  if (fileRows === undefined) {
    return lines;
  }
  for (const row of fileRows) {
    const anchorable =
      row.kind === DiffLineKinds.ADD || row.kind === DiffLineKinds.CTX;
    if (anchorable && row.newLine !== undefined) {
      lines.add(row.newLine);
    }
  }

  return lines;
}

function isOwner(owners: FileLineOwners | undefined, chunkId: string): boolean {
  return owners?.chunks.some((chunk) => chunk.id === chunkId) === true;
}

/**
 * Whether a row another diff produced takes a comment, and on which chunk of
 * the full brief. GitHub holds a comment only on a line of the PR's base to
 * head diff, so the row needs a new-side line the PR diff carries; a
 * left-side row's line is in the baseline's coordinates and has no home.
 * A row that came from an owner's own diff is in the PR diff by
 * construction. The owner always comes from the same resolver the session
 * reads a draft back through, so the row that made a draft and the row
 * that shows it agree, leading context included.
 */
export function resolveGuestRow(
  line: DiffLine,
  input: GuestRowsInput,
  origin?: GuestRowOrigin,
  prLines: ReadonlySet<number> = collectPrLines(input.fileRows),
): GuestRowResolution {
  const newLine = line.newLine;
  if (newLine === undefined) {
    return refuse(GuestRowReasons.REMOVED_BEFORE_HEAD);
  }
  const fromOwner =
    origin !== undefined && isOwner(input.owners, origin.chunkId);
  if (!fromOwner && input.fileRows === undefined) {
    return refuse(GuestRowReasons.PR_DIFF_UNAVAILABLE);
  }
  if (!fromOwner && !prLines.has(newLine)) {
    return refuse(GuestRowReasons.NOT_IN_PR_DIFF);
  }

  const chunks = input.owners?.chunks ?? [];
  const owner = resolveChunkForLine(chunks, input.file, NEW_SIDE, newLine);
  if (owner === undefined) {
    return refuse(GuestRowReasons.FILE_NOT_IN_BRIEF);
  }

  return {
    commentable: true,
    chunkId: owner.id,
    side: NEW_SIDE,
    line: newLine,
  };
}

/** Whether a composer host is a guest table of the Changes pane rather than a Full card. */
export function isGuestHost(hostId: string): boolean {
  return Object.values(GuestHostPrefixes).some((prefix) =>
    hostId.startsWith(prefix),
  );
}

/** Every code row of a guest table resolved once; a full-width row has no entry. */
export function resolveGuestRows(
  rows: readonly DiffLine[],
  input: GuestRowsInput,
  isCodeRow: (line: DiffLine) => boolean,
): (GuestRowResolution | undefined)[] {
  const prLines = collectPrLines(input.fileRows);

  return rows.map((line, index) => {
    if (!isCodeRow(line)) {
      return undefined;
    }

    return resolveGuestRow(line, input, input.originOf?.(index), prLines);
  });
}
