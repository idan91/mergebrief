// Store vocabulary → wire vocabulary for the session writes. The store keys
// by brief-local ids; the wire keys by content anchor (file, attribute, line
// region), so the model resolves one into the other here — the same anchors
// the read resolved back.
import type { BriefViewModel } from "@web/features/brief/utils";
import type { Category } from "../../brief/types";
import type { CommentAnchor, ReviewComment } from "../utils/comments";
import type { ReviewOutcome, RiskEvidence } from "../utils/state";
import type { BulkDisposition } from "./disposition";
import { getChunkRegion } from "../utils/state";
import type {
  EvidenceWire,
  FlagAnchorWire,
  SessionWriteResult,
  SessionWrites,
} from "./writes";

/** The write side of the store — one method per user action. */
export interface SessionWriteGateway {
  setRead(chunkId: string, read: boolean): Promise<SessionWriteResult>;
  dispose(
    flagIds: readonly string[],
    disposition: BulkDisposition,
  ): Promise<SessionWriteResult>;
  address(
    evidenceByFlagId: ReadonlyMap<string, RiskEvidence>,
  ): Promise<SessionWriteResult>;
  reclassify(groupId: string, category: Category): Promise<SessionWriteResult>;
  createComment(
    comment: Omit<ReviewComment, "id">,
  ): Promise<SessionWriteResult<string>>;
  updateComment(id: string, body: string): Promise<SessionWriteResult>;
  reanchorComment(
    id: string,
    anchor: CommentAnchor,
  ): Promise<SessionWriteResult>;
  deleteComment(id: string): Promise<SessionWriteResult>;
  setOutcome(outcome: ReviewOutcome): Promise<SessionWriteResult>;
}

/** The ref a stored evidence row carries — the kind decides which field. */
function evidenceRef(evidence: RiskEvidence): string {
  if (evidence.kind === "linked-comment") return evidence.commentId ?? "";
  if (evidence.kind === "chunk-reviewed") return evidence.chunkId ?? "";
  return evidence.note ?? "";
}

function toEvidenceWire(evidence: RiskEvidence): EvidenceWire {
  return { kind: evidence.kind, ref: evidenceRef(evidence) };
}

/** Brief-local flag id → the anchor its disposition row keys on. */
function flagAnchors(model: BriefViewModel): Map<string, FlagAnchorWire> {
  const regions = new Map(
    model.groups
      .flatMap((group) => group.chunks)
      .map((chunk) => [chunk.id, getChunkRegion(chunk)]),
  );
  const anchors = new Map<string, FlagAnchorWire>();
  for (const flag of model.flags) {
    const region = regions.get(flag.chunkId);
    if (region === undefined) continue;
    anchors.set(flag.id, {
      filePath: flag.file,
      attribute: flag.attr,
      regionStart: region.start,
      regionEnd: region.end,
    });
  }
  return anchors;
}

/**
 * A decision that resolved to nothing sendable. NEVER reported as success:
 * the store would keep the disposition, the receipt would count it, and the
 * next read would silently drop it — a risk the reviewer believes is settled
 * and the server never heard about.
 */
const UNRESOLVED: SessionWriteResult = {
  ok: false,
  failure: { frozen: false, copy: "review.writeError.unresolvedRisk" },
};

export function createSessionWriteGateway(
  model: BriefViewModel,
  writes: SessionWrites,
): SessionWriteGateway {
  const anchors = flagAnchors(model);
  const anchorsOf = (flagIds: Iterable<string>): FlagAnchorWire[] =>
    [...flagIds].flatMap((id) => {
      const anchor = anchors.get(id);
      return anchor === undefined ? [] : [anchor];
    });

  return {
    setRead: (chunkId, read) => writes.setRead(chunkId, read),
    dispose(flagIds, disposition) {
      const flags = anchorsOf(flagIds);
      if (flags.length !== flagIds.length) return Promise.resolve(UNRESOLVED);
      return disposition.kind === "open"
        ? writes.reopenRisks(flags)
        : writes.dismissRisks(flags, disposition.reason);
    },
    address(evidenceByFlagId) {
      // An evidence claim with no ref is refused at the route ("evidence needs
      // a ref"). A partial send is worse than none: the reviewer would see
      // every flag addressed and only some of them stored.
      const flags = [...evidenceByFlagId].flatMap(([id, evidence]) => {
        const anchor = anchors.get(id);
        const wire = toEvidenceWire(evidence);
        return anchor === undefined || wire.ref === ""
          ? []
          : [{ ...anchor, evidence: wire }];
      });
      if (flags.length !== evidenceByFlagId.size) {
        return Promise.resolve(UNRESOLVED);
      }
      return writes.addressRisks(flags);
    },
    reclassify: (groupId, category) => writes.reclassify(groupId, category),
    createComment: (comment) =>
      writes.createDraft({
        filePath: comment.anchor.file,
        side: comment.anchor.side,
        startLine: comment.anchor.startLine,
        endLine: comment.anchor.endLine,
        body: comment.body,
      }),
    updateComment: (id, body) => writes.updateDraft(id, body),
    reanchorComment: (id, anchor) =>
      writes.reanchorDraft(id, {
        filePath: anchor.file,
        side: anchor.side,
        startLine: anchor.startLine,
        endLine: anchor.endLine,
      }),
    deleteComment: (id) => writes.deleteDraft(id),
    setOutcome: (outcome) => writes.setOutcome(outcome),
  };
}
