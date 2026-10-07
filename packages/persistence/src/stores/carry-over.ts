// Carry-over evaluation: pure, in memory, writes nothing. Given the previous
// session's rows and what the new Brief offers, it says where each piece of
// work lands. The store calls it twice: once on read (nothing is created) and
// once inside the materialization transaction, against rows re-read there.
//
// The asymmetry it exists to keep: an item that cannot be placed orphans, and
// orphaned work is never deleted, only unplaced. Nothing here may ever settle
// or mark-read on a guess.
import type { FlagKey } from "brief-core/artifact";
import { RemapOutcomes, remapThroughHops, type Hop } from "brief-core/remap";
import {
  AnchorStatuses,
  CommentAnchorKinds,
  DraftCommentSides,
  DraftCommentStatuses,
  type AnchorStatus,
  type DraftCommentStatus,
} from "types/comments";
import type { DraftAnchor, LineDraftAnchor } from "../types";
import type { ChangeGroupCategory } from "types/reviews";
import {
  DispositionCarryStatuses,
  DispositionEvidenceKinds,
  DispositionEvidenceStatuses,
  type DispositionCarryStatus,
  type DispositionDecision,
  type DispositionEvidence,
  type DispositionEvidenceStatus,
} from "types/dispositions";
import { HunkSpansSchema } from "./artifact-store";

/** What the NEW Brief offers the evaluation: everything outside the reviewer's rows. */
export interface CarryOverContext {
  /** `brief.carried_chunk_ids`: the ONLY thing a read mark may carry against. */
  readonly carriedChunkIds: readonly string[];
  /** Change-group ids the new Brief emits; a reclassification needs its id here. */
  readonly groupIds: readonly string[];
  /**
   * True only when every Brief between the previous session's and this one
   * descended its ids (`anchor_state = 'anchored'`). A restart re-derives
   * groups from scratch, so an id present there is numbering coincidence,
   * not the group the reviewer judged, and every reclassification drops.
   */
  readonly groupIdsDescended: boolean;
  /** Flags the new Brief emits; an absent one drops its disposition. */
  readonly flags: readonly FlagKey[];
  /**
   * Previous head → current head, oldest first. `null` = the chain could not
   * be linked end to end, which orphans every anchor rather than guessing.
   */
  readonly hops: readonly Hop[] | null;
  /** Paths the current Brief still shows; a File comment keys on these. */
  readonly filePaths: readonly string[];
  /** A retarget: old-side coordinates stop meaning anything. */
  readonly baseShaMoved: boolean;
}

/** The previous session's work, as read. */
export interface PreviousWork {
  readonly draftComments: readonly PreviousDraftComment[];
  readonly readMarks: readonly string[];
  readonly reclassifications: readonly PreviousReclassification[];
  readonly dispositions: readonly PreviousDisposition[];
}

export interface PreviousDraftComment {
  /**
   * The row id in the PREVIOUS session. It survives the evaluation so the
   * payload can address a verdict that is not a row here yet, and so
   * materialization can map that id onto the copy it lands.
   */
  readonly id: bigint;
  readonly anchor: DraftAnchor;
  readonly body: string;
  readonly status: DraftCommentStatus;
  /** The row this one was copied from, one session back; null if authored here. */
  readonly carriedFromCommentId: bigint | null;
}

export interface PreviousReclassification {
  readonly changeGroupId: string;
  readonly category: ChangeGroupCategory;
}

export interface PreviousDisposition extends FlagKey {
  readonly decision: DispositionDecision;
  readonly reason: string | null;
  readonly evidenceStatus: DispositionEvidenceStatus | null;
  /** What an addressing decision pointed at; null on a dismissal. */
  readonly evidence: DispositionEvidence | null;
  readonly decidedAt: Date;
}

export interface CarriedDraftComment extends PreviousDraftComment {
  /** NULL = the anchor still holds exactly. */
  readonly anchorStatus: AnchorStatus | null;
}

export interface CarriedDisposition extends PreviousDisposition {
  readonly carryStatus: DispositionCarryStatus;
}

/** Where every piece of the previous session's work lands on the new Brief. */
export interface CarriedWork {
  readonly draftComments: readonly CarriedDraftComment[];
  /** Only the marks whose chunk id is in the new Brief's carried set. */
  readonly readMarks: readonly string[];
  readonly reclassifications: readonly PreviousReclassification[];
  readonly dispositions: readonly CarriedDisposition[];
}

export const NOTHING_CARRIED: CarriedWork = {
  draftComments: [],
  readMarks: [],
  reclassifications: [],
  dispositions: [],
};

/** One stored hop row, reduced to what the chain needs. */
export interface HopRow {
  readonly baselineSha: string;
  readonly headSha: string;
  readonly spans: string;
}

/**
 * Link the stored hops into one chain by SHA, oldest first. `heads` is the
 * consecutive Brief heads from the previous session's Brief to the current
 * one. Row order is insertion order and never chain order, and rows fork on a
 * shared baseline, so the pair is the only link. A missing or unparseable
 * link returns `null`: a partial chain places anchors on post-push line
 * numbers, which is the one outcome worse than orphaning them.
 */
export function assembleHops(
  heads: readonly string[],
  rows: readonly HopRow[],
): Hop[] | null {
  const byPair = new Map(
    rows.map((row) => [hopKey(row.baselineSha, row.headSha), row]),
  );
  const chain: Hop[] = [];
  for (let index = 1; index < heads.length; index++) {
    const row = byPair.get(hopKey(heads[index - 1], heads[index]));
    if (row === undefined) {
      return null;
    }
    const parsed = HunkSpansSchema.safeParse(readJson(row.spans));
    if (!parsed.success) {
      return null;
    }
    chain.push(parsed.data);
  }
  return chain;
}

function hopKey(
  baselineSha: string | undefined,
  headSha: string | undefined,
): string {
  return `${baselineSha}\u0000${headSha}`;
}

function readJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Remap one anchor's single range, or `undefined` when it cannot be placed. */
function replace(
  context: CarryOverContext,
  filePath: string,
  start: number,
  end: number,
): { start: number; end: number } | undefined {
  if (context.hops === null) {
    return undefined;
  }
  const result = remapThroughHops(filePath, [{ start, end }], context.hops);
  if (result.outcome === RemapOutcomes.DEMOTED) {
    return undefined;
  }
  const range = result.ranges[0];
  return range === undefined ? undefined : range;
}

interface PlacedLineDraftComment extends PreviousDraftComment {
  readonly anchor: LineDraftAnchor;
}

function relocateLineComment(
  comment: PlacedLineDraftComment,
  startLine: number,
  endLine: number,
  anchorStatus: AnchorStatus | null,
): CarriedDraftComment {
  return {
    ...comment,
    anchor: {
      ...comment.anchor,
      startLine,
      endLine,
    },
    anchorStatus,
  };
}

/**
 * A two-side range is one anchor with a leg on each side: the old leg holds
 * only while the PR base does, and the new leg rides the hops. Both-or-orphan:
 * a range that lost either endpoint never shrinks to single-side.
 */
function carryTwoSideComment(
  comment: PlacedLineDraftComment,
  context: CarryOverContext,
): CarriedDraftComment {
  if (context.baseShaMoved || context.hops === null) {
    return { ...comment, anchorStatus: AnchorStatuses.ORPHANED };
  }
  const { anchor } = comment;
  const newLine =
    anchor.startSide === DraftCommentSides.NEW
      ? anchor.startLine
      : anchor.endLine;
  const placed = replace(context, anchor.file, newLine, newLine);
  if (placed === undefined) {
    return { ...comment, anchorStatus: AnchorStatuses.ORPHANED };
  }
  if (placed.start === newLine) {
    return { ...comment, anchorStatus: null };
  }
  if (anchor.startSide === DraftCommentSides.NEW) {
    return relocateLineComment(
      comment,
      placed.start,
      anchor.endLine,
      AnchorStatuses.MOVED,
    );
  }
  return relocateLineComment(
    comment,
    anchor.startLine,
    placed.start,
    AnchorStatuses.MOVED,
  );
}

function carryFileComment(
  comment: PreviousDraftComment,
  context: CarryOverContext,
): CarriedDraftComment {
  const inBrief = context.filePaths.includes(comment.anchor.file);
  return {
    ...comment,
    anchorStatus: inBrief ? null : AnchorStatuses.ORPHANED,
  };
}

function carryLineComment(
  comment: PlacedLineDraftComment,
  context: CarryOverContext,
): CarriedDraftComment {
  if (comment.anchor.startSide !== undefined) {
    return carryTwoSideComment(comment, context);
  }
  // Old-side coordinates live against the PR base, which the hops say nothing
  // about, so a base that held still leaves them exact. A moved base or a
  // chain that cannot be trusted still orphans them: an untrustworthy span
  // orphans every anchor it covers, whichever side it sits on.
  if (comment.anchor.side === DraftCommentSides.OLD) {
    const unplaceable = context.baseShaMoved || context.hops === null;
    return {
      ...comment,
      anchorStatus: unplaceable ? AnchorStatuses.ORPHANED : null,
    };
  }
  const placed = replace(
    context,
    comment.anchor.file,
    comment.anchor.startLine,
    comment.anchor.endLine,
  );
  if (placed === undefined) {
    return { ...comment, anchorStatus: AnchorStatuses.ORPHANED };
  }
  if (
    placed.start === comment.anchor.startLine &&
    placed.end === comment.anchor.endLine
  ) {
    return { ...comment, anchorStatus: null };
  }
  return relocateLineComment(
    comment,
    placed.start,
    placed.end,
    AnchorStatuses.MOVED,
  );
}

function carryComment(
  comment: PreviousDraftComment,
  context: CarryOverContext,
): CarriedDraftComment {
  if (comment.anchor.kind === CommentAnchorKinds.FILE) {
    return carryFileComment(comment, context);
  }
  return carryLineComment({ ...comment, anchor: comment.anchor }, context);
}

/**
 * Previous-Brief to current-Brief ladder: unplaceable or touched region
 * reopens; the attribute gone from the file or this occurrence drops;
 * otherwise settled. Remap runs first so every verdict stores current
 * coordinates. Ambiguity reopens: a false settled is the silent rubber-stamp.
 */
function carryDisposition(
  row: PreviousDisposition,
  context: CarryOverContext,
  firing: ReadonlyMap<string, readonly FlagKey[]>,
  survivingEvidence: SurvivingEvidence,
): CarriedDisposition {
  // The pointer advances on EVERY hop, whatever the ladder says. A ref that
  // only moved when the decision settled would be two generations stale after
  // two reopens, and then read as gone against work that never went away.
  const carried = { ...row, ...carryEvidence(row, survivingEvidence) };
  const occurrences = firing.get(attributeKey(row));
  const placed = replace(context, row.filePath, row.regionStart, row.regionEnd);
  if (placed === undefined) {
    // Nowhere to put it. An attribute that stopped firing altogether is still
    // dropped; anything else asks for a re-look on its old coordinates, the
    // only ones it has.
    const unplaceable =
      occurrences === undefined
        ? DispositionCarryStatuses.DROPPED
        : DispositionCarryStatuses.REOPENED;
    return { ...carried, carryStatus: unplaceable };
  }
  const located = {
    ...carried,
    regionStart: placed.start,
    regionEnd: placed.end,
  };
  if (occurrences === undefined) {
    return { ...located, carryStatus: DispositionCarryStatuses.DROPPED };
  }
  // Overlap, not equality: the region is remapped and chunk bounds are
  // re-derived per Brief, so an exact-region rule would drop live decisions.
  const stillFiring = occurrences.some(
    (flag) => flag.regionStart <= placed.end && flag.regionEnd >= placed.start,
  );
  if (!stillFiring) {
    return { ...located, carryStatus: DispositionCarryStatuses.DROPPED };
  }
  return {
    ...located,
    carryStatus: DispositionCarryStatuses.SETTLED,
  };
}

/** What a carried decision's evidence may still point at on the new Brief. */
/** A live comment: the id it answers to now, and whether GitHub holds it. */
interface SurvivingComment {
  readonly id: string;
  readonly published: boolean;
}

interface SurvivingEvidence {
  /**
   * Every id a live comment answers to → the id it answers to NOW. A copy
   * gets a fresh row id each hop, so the id the reviewer cited goes stale
   * unless the pointer is re-normalized forward the way draft addressing is.
   */
  readonly draftComments: ReadonlyMap<string, SurvivingComment>;
  readonly chunkIds: ReadonlySet<string>;
}

/**
 * A dangling pointer is CLEARED rather than carried: the decision then reads
 * as addressed with no proof: exactly the `missing-evidence` condition the
 * submit list already names, so the attention list mints no new kind for it.
 * A note points at nothing, so it can never dangle.
 */
function carryEvidence(
  row: PreviousDisposition,
  surviving: SurvivingEvidence,
): Pick<PreviousDisposition, "evidence" | "evidenceStatus"> {
  if (row.evidence === null || row.evidence.ref === null) {
    return { evidence: row.evidence, evidenceStatus: row.evidenceStatus };
  }
  const kept = { evidence: row.evidence, evidenceStatus: row.evidenceStatus };
  if (row.evidence.kind === DispositionEvidenceKinds.MANUAL_NOTE) {
    return kept;
  }
  if (row.evidence.kind === DispositionEvidenceKinds.LINKED_COMMENT) {
    const now = surviving.draftComments.get(row.evidence.ref);
    if (now !== undefined) {
      return {
        // A published comment leaves the session for GitHub, so the next hop
        // has no row to point at. The proof is the firmest there is and must
        // not decay: drop the pointer and the claim stands on its own.
        evidence: {
          kind: row.evidence.kind,
          ref: now.published ? null : now.id,
        },
        evidenceStatus: row.evidenceStatus,
      };
    }
  } else if (surviving.chunkIds.has(row.evidence.ref)) {
    return kept;
  }
  return {
    evidence: null,
    evidenceStatus: DispositionEvidenceStatuses.MISSING_EVIDENCE,
  };
}

/**
 * A remap can land two decisions on ONE anchor; one shifted onto the other's
 * region. The anchor is a unique key, so the pair must become a single row;
 * the survivor is the one that asks for a re-look, never the one that settles.
 */
function mergeOnAnchor(
  rows: readonly CarriedDisposition[],
): CarriedDisposition[] {
  const byAnchor = new Map<string, CarriedDisposition>();
  for (const row of rows) {
    const key = `${attributeKey(row)}\u0000${row.regionStart}-${row.regionEnd}`;
    const held = byAnchor.get(key);
    if (held === undefined) {
      byAnchor.set(key, row);
      continue;
    }
    if (held.carryStatus !== DispositionCarryStatuses.REOPENED) {
      byAnchor.set(key, row);
    }
  }
  return [...byAnchor.values()];
}

function attributeKey(flag: { filePath: string; attribute: string }): string {
  return `${flag.filePath}\u0000${flag.attribute}`;
}

/** The new Brief's flags, grouped so one occurrence can be tested at a time. */
function firingOccurrences(flags: readonly FlagKey[]): Map<string, FlagKey[]> {
  const byAttribute = new Map<string, FlagKey[]>();
  for (const flag of flags) {
    const key = attributeKey(flag);
    const held = byAttribute.get(key);
    if (held === undefined) {
      byAttribute.set(key, [flag]);
      continue;
    }
    held.push(flag);
  }
  return byAttribute;
}

/**
 * Place the previous session's work on the new Brief: read marks carry
 * ONLY against the persisted carried chunk set, reclassifications carry only
 * where the group id descended, and the review outcome never carries at all:
 * an `approve` picked against old code is the one carry that does damage.
 */
export function evaluateCarryOver(
  previous: PreviousWork,
  context: CarryOverContext,
): CarriedWork {
  const carriedChunks = new Set(context.carriedChunkIds);
  const groups = new Set(context.groupIds);
  const firing = firingOccurrences(context.flags);
  const draftComments = previous.draftComments
    .filter((comment) => comment.status === DraftCommentStatuses.DRAFT)
    .map((comment) => carryComment(comment, context));
  const surviving: SurvivingEvidence = {
    // Every comment the previous session held, not only the ones that
    // carried: a comment the reviewer PUBLISHED is firmer proof than a draft,
    // so it must not read as gone. Only a deleted one leaves no row at all.
    // Both of a row's ids map to it, exactly as draft addressing resolves:
    // the id a reviewer cited stays good however many hops it has ridden.
    draftComments: new Map(
      previous.draftComments.flatMap((row) => {
        const now: SurvivingComment = {
          id: String(row.id),
          published: row.status === DraftCommentStatuses.SUBMITTED,
        };
        const carried = row.carriedFromCommentId;
        const pairs: [string, SurvivingComment][] = [[now.id, now]];
        if (carried !== null) {
          pairs.push([String(carried), now]);
        }
        return pairs;
      }),
    ),
    // A chunk is proof only on the terms a read mark is: the persisted
    // carried set, never a bare id match against a re-minted chunk.
    chunkIds: carriedChunks,
  };
  return {
    draftComments,
    // A bare chunk-id match is forbidden: ids get a collision guard, not
    // descent, so a match against the previous Brief's full id set would mark
    // a Chunk the reviewer never opened as read.
    readMarks: previous.readMarks.filter((chunkId) =>
      carriedChunks.has(chunkId),
    ),
    reclassifications: context.groupIdsDescended
      ? previous.reclassifications.filter((row) =>
          groups.has(row.changeGroupId),
        )
      : [],
    dispositions: mergeOnAnchor(
      previous.dispositions.map((row) =>
        carryDisposition(row, context, firing, surviving),
      ),
    ),
  };
}
