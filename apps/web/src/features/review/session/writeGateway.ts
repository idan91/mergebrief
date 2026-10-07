import type { BriefViewModel } from "@web/features/brief/utils";
import type { Category } from "../../brief/types";
import type { CommentAnchor, ReviewComment } from "../utils/comments";
import type { ReviewOutcome, RiskEvidence } from "../utils/state";
import type { BulkDisposition } from "./disposition";
import {
  buildDraftAnchorWire,
  buildEvidenceWire,
  buildFlagAnchorWires,
} from "./anchors";
import type {
  FlagAnchorWire,
  SessionWriteResult,
  SessionWrites,
} from "./writes";

/** The write side of the store, one method per user action. */
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

/**
 * A decision that resolved to nothing sendable. NEVER reported as success:
 * the store would keep the disposition, the receipt would count it, and the
 * next read would silently drop it, a risk the reviewer believes is settled
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
  const anchors = buildFlagAnchorWires(model);
  const buildFlagAnchors = (flagIds: Iterable<string>): FlagAnchorWire[] =>
    [...flagIds].flatMap((id) => {
      const anchor = anchors.get(id);
      return anchor === undefined ? [] : [anchor];
    });

  return {
    setRead: (chunkId, read) => writes.setRead(chunkId, read),
    dispose(flagIds, disposition) {
      const flags = buildFlagAnchors(flagIds);
      if (flags.length !== flagIds.length) {
        return Promise.resolve(UNRESOLVED);
      }
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
        const wire = buildEvidenceWire(evidence);
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
    createComment: (comment) => {
      const draft = buildDraftAnchorWire(comment.anchor);
      return writes.createDraft({ ...draft, body: comment.body });
    },
    updateComment: (id, body) => writes.updateDraft(id, body),
    reanchorComment: (id, anchor) =>
      writes.reanchorDraft(id, buildDraftAnchorWire(anchor)),
    deleteComment: (id) => writes.deleteDraft(id),
    setOutcome: (outcome) => writes.setOutcome(outcome),
  };
}
