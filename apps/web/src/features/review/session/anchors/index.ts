import type { BriefChunk, BriefViewModel } from "@web/features/brief/model";
import {
  CommentAnchorKinds,
  DispositionCarryStatuses,
  DispositionDecisions,
  DispositionEvidenceKinds,
} from "types";
import {
  createFileCommentAnchor,
  isFileCommentAnchor,
  type CommentAnchor,
  type LineCommentAnchor,
  type ReviewComment,
} from "../../utils/comments";
import {
  getChunkRegion,
  isFlagUnderAnchor,
  type ChunkRegion,
  type RiskEvidence,
} from "../../utils/state";
import type { Disposition } from "../disposition";
import { DispositionKinds } from "../types";
import type { SessionDisposition, SessionDraftComment } from "../serverState";
import type {
  DraftAnchorWire,
  EvidenceWire,
  FlagAnchorWire,
  LineDraftAnchorWire,
} from "../writes";
import type {
  ChunkRegions,
  DispositionsByFlag,
  FlagAnchorWires,
  ResolvedDrafts,
} from "./types";
import {
  collectChunks,
  collectDraftRows,
  getEvidenceRef,
  resolveDraftChunk,
} from "./utils";

const regionsByModel = new WeakMap<BriefViewModel, ChunkRegions>();

/** Built once per view model; every resolution in both directions reads it. */
export function getChunkRegions(model: BriefViewModel): ChunkRegions {
  const cached = regionsByModel.get(model);
  if (cached !== undefined) {
    return cached;
  }

  const regions = new Map<string, ChunkRegion>();
  for (const chunk of collectChunks(model)) {
    regions.set(chunk.id, getChunkRegion(chunk));
  }
  regionsByModel.set(model, regions);
  return regions;
}

export function buildFlagAnchorWires(model: BriefViewModel): FlagAnchorWires {
  const regions = getChunkRegions(model);
  const anchors = new Map<string, FlagAnchorWire>();

  for (const flag of model.flags) {
    const region = regions.get(flag.chunkId);
    if (region === undefined) {
      continue;
    }
    anchors.set(flag.id, {
      filePath: flag.file,
      attribute: flag.attr,
      regionStart: region.start,
      regionEnd: region.end,
    });
  }

  return anchors;
}

export function buildDraftAnchorWire(anchor: CommentAnchor): DraftAnchorWire {
  if (isFileCommentAnchor(anchor)) {
    return { kind: CommentAnchorKinds.FILE, filePath: anchor.file };
  }

  const wire: LineDraftAnchorWire = {
    kind: CommentAnchorKinds.LINE,
    filePath: anchor.file,
    side: anchor.side,
    startLine: anchor.startLine,
    endLine: anchor.endLine,
  };
  if (anchor.startSide !== undefined) {
    wire.startSide = anchor.startSide;
  }
  return wire;
}

export function buildEvidenceWire(evidence: RiskEvidence): EvidenceWire {
  return { kind: evidence.kind, ref: getEvidenceRef(evidence) };
}

/** The store's evidence shape from the row's two columns. */
export function resolveEvidence(
  evidence: SessionDisposition["evidence"],
): RiskEvidence | undefined {
  if (evidence === undefined) {
    return undefined;
  }

  const ref = evidence.ref ?? "";
  if (evidence.kind === DispositionEvidenceKinds.LINKED_COMMENT) {
    return { kind: evidence.kind, commentId: ref };
  }
  if (evidence.kind === DispositionEvidenceKinds.CHUNK_REVIEWED) {
    return { kind: evidence.kind, chunkId: ref };
  }
  return { kind: evidence.kind, note: ref };
}

/**
 * A reopened carried decision reads as OPEN: the region it stood on was
 * touched, so the flag needs deciding again, and rendering it as still
 * decided would hide the one thing the attention list is asking for.
 */
function resolveDisposition(row: SessionDisposition): Disposition {
  if (row.carryStatus === DispositionCarryStatuses.REOPENED) {
    return { kind: DispositionKinds.OPEN };
  }
  if (row.decision === DispositionDecisions.DISMISSED) {
    return { kind: DispositionKinds.DISMISSED, reason: row.reason ?? "" };
  }

  const evidence = resolveEvidence(row.evidence);
  const addressed: Disposition = { kind: DispositionKinds.ADDRESSED };
  if (evidence) {
    addressed.evidence = evidence;
  }
  return addressed;
}

/**
 * Dispositions land on every flag their anchor covers: the wire's region is
 * the chunk's, so one row addresses one flag unless a Brief carries the same
 * attribute twice over the same span.
 */
export function resolveDispositions(
  rows: readonly SessionDisposition[],
  model: BriefViewModel,
  base: DispositionsByFlag,
): DispositionsByFlag {
  const regions = getChunkRegions(model);
  const resolved = { ...base };

  for (const row of rows) {
    const anchor = {
      filePath: row.filePath,
      attribute: row.attribute,
      startLine: row.regionStart,
      endLine: row.regionEnd,
    };
    for (const flag of model.flags) {
      const covered = isFlagUnderAnchor(
        flag,
        regions.get(flag.chunkId),
        anchor,
      );
      if (covered) {
        resolved[flag.id] = resolveDisposition(row);
      }
    }
  }

  return resolved;
}

/** Undefined = no chunk in this Brief holds the draft. */
function resolveDraftComment(
  draft: SessionDraftComment,
  chunks: readonly BriefChunk[],
): ReviewComment | undefined {
  const fields = { id: draft.id, body: draft.body, status: draft.status };

  if (draft.kind === CommentAnchorKinds.FILE) {
    const inBrief = chunks.some((chunk) => chunk.file === draft.filePath);
    if (!inBrief) {
      return undefined;
    }
    const anchor = createFileCommentAnchor(draft.filePath);
    return { ...fields, anchor, collapsed: false };
  }

  const chunk = resolveDraftChunk(chunks, draft);
  if (chunk === undefined) {
    return undefined;
  }

  const { rowIds, selectedText } = collectDraftRows(chunk, draft);
  const anchor: LineCommentAnchor = {
    kind: CommentAnchorKinds.LINE,
    chunkId: chunk.id,
    file: draft.filePath,
    side: draft.side,
    startLine: draft.startLine,
    endLine: draft.endLine,
    rowIds,
    selectedText,
  };
  if (draft.startSide !== undefined) {
    anchor.startSide = draft.startSide;
  }
  return { ...fields, anchor, collapsed: false };
}

/**
 * Durable wire anchors into brief-local ids. A draft with no rendered chunk is
 * kept apart as unplaced: the submit route still posts it, so the submit guard
 * measures it.
 */
export function resolveDraftComments(
  drafts: readonly SessionDraftComment[],
  model: BriefViewModel,
): ResolvedDrafts {
  const chunks = collectChunks(model);
  const resolved: ResolvedDrafts = { reviewComments: [], unplacedDrafts: [] };

  for (const draft of drafts) {
    const comment = resolveDraftComment(draft, chunks);
    if (comment === undefined) {
      resolved.unplacedDrafts.push(draft);
    } else {
      resolved.reviewComments.push(comment);
    }
  }

  return resolved;
}
