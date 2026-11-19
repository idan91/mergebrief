// The demo's Review Session: every session write lands in tab memory, keyed
// by the span it names, and the session read answers from it. A reload starts
// over from the fixture's empty session.
import {
  type CreateDraftCommentBody,
  type DraftAnchorWire,
  type DraftCommentPayload,
  type EvidencedFlagAnchorWire,
  type FlagAnchorWire,
  type SessionPayload,
} from "contract";
import {
  type ChangeGroupCategory,
  CommentAnchorKinds,
  DispositionDecisions,
  DraftCommentStatuses,
  type ReviewOutcome,
  ReviewOutcomes,
} from "types";

import type { DemoSessionRecord, DemoSessionSpan } from "./types";

const DRAFT_ID_PREFIX = "demo-draft-";
const DISPOSITION_ID_PREFIX = "demo-disposition-";

/** Every session operation the demo answers, one function each. */
export interface DemoSessionStore {
  readSession(span: DemoSessionSpan): SessionPayload;
  createDraft(span: DemoSessionSpan, draft: CreateDraftCommentBody): string;
  updateDraft(span: DemoSessionSpan, draftId: string, body: string): boolean;
  reanchorDraft(
    span: DemoSessionSpan,
    draftId: string,
    anchor: DraftAnchorWire,
  ): boolean;
  deleteDraft(span: DemoSessionSpan, draftId: string): boolean;
  setChunkRead(span: DemoSessionSpan, chunkId: string, read: boolean): void;
  reclassifyGroup(
    span: DemoSessionSpan,
    groupId: string,
    category: ChangeGroupCategory,
  ): void;
  dismissRisks(
    span: DemoSessionSpan,
    flags: readonly FlagAnchorWire[],
    reason: string,
  ): number;
  addressRisks(
    span: DemoSessionSpan,
    flags: readonly EvidencedFlagAnchorWire[],
  ): number;
  reopenRisks(span: DemoSessionSpan, flags: readonly FlagAnchorWire[]): number;
  setOutcome(span: DemoSessionSpan, outcome: ReviewOutcome): ReviewOutcome;
}

function buildSpanKey(span: DemoSessionSpan): string {
  return `${span.base}..${span.head}`;
}

function buildFlagKey(flag: FlagAnchorWire): string {
  return `${flag.filePath}\n${flag.attribute}\n${flag.regionStart}\n${flag.regionEnd}`;
}

function createRecord(): DemoSessionRecord {
  return {
    materialized: false,
    reviewOutcome: ReviewOutcomes.COMMENT,
    draftComments: [],
    readMarks: new Set(),
    reclassifications: new Map(),
    dispositions: new Map(),
  };
}

function shapeDraft(
  id: string,
  anchor: DraftAnchorWire,
  body: string,
): DraftCommentPayload {
  const base = {
    id,
    filePath: anchor.filePath,
    body,
    status: DraftCommentStatuses.DRAFT,
    anchorStatus: null,
  };
  if (anchor.kind === CommentAnchorKinds.FILE) {
    return { ...base, kind: CommentAnchorKinds.FILE };
  }
  const line = {
    ...base,
    kind: CommentAnchorKinds.LINE,
    side: anchor.side,
    startLine: anchor.startLine,
    endLine: anchor.endLine,
  };
  if (anchor.startSide === undefined) {
    return line;
  }
  return { ...line, startSide: anchor.startSide };
}

export function createDemoSessionStore(): DemoSessionStore {
  const records = new Map<string, DemoSessionRecord>();
  let nextId = 1;

  function peekRecord(span: DemoSessionSpan): DemoSessionRecord | undefined {
    return records.get(buildSpanKey(span));
  }

  function writeRecord(span: DemoSessionSpan): DemoSessionRecord {
    const key = buildSpanKey(span);
    const record = records.get(key) ?? createRecord();
    record.materialized = true;
    records.set(key, record);
    return record;
  }

  function findDraftIndex(span: DemoSessionSpan, draftId: string): number {
    return (
      peekRecord(span)?.draftComments.findIndex(
        (draft) => draft.id === draftId,
      ) ?? -1
    );
  }

  function replaceDraft(
    span: DemoSessionSpan,
    draftId: string,
    replace: (draft: DraftCommentPayload) => DraftCommentPayload,
  ): boolean {
    const index = findDraftIndex(span, draftId);
    const draft = peekRecord(span)?.draftComments[index];
    if (draft === undefined) {
      return false;
    }
    writeRecord(span).draftComments[index] = replace(draft);
    return true;
  }

  function issueId(prefix: string): string {
    const id = `${prefix}${nextId}`;
    nextId += 1;
    return id;
  }

  return {
    readSession(span) {
      const record = peekRecord(span) ?? createRecord();
      return {
        materialized: record.materialized,
        carriedFrom: null,
        reviewOutcome: record.reviewOutcome,
        draftComments: [...record.draftComments],
        readMarks: [...record.readMarks],
        reclassifications: [...record.reclassifications.values()],
        dispositions: [...record.dispositions.values()],
        submittedReviewIds: [],
        attention: [],
      };
    },
    createDraft(span, draft) {
      const id = issueId(DRAFT_ID_PREFIX);
      writeRecord(span).draftComments.push(shapeDraft(id, draft, draft.body));
      return id;
    },
    updateDraft(span, draftId, body) {
      return replaceDraft(span, draftId, (draft) => ({ ...draft, body }));
    },
    reanchorDraft(span, draftId, anchor) {
      return replaceDraft(span, draftId, (draft) =>
        shapeDraft(draft.id, anchor, draft.body),
      );
    },
    deleteDraft(span, draftId) {
      const index = findDraftIndex(span, draftId);
      if (index < 0) {
        return false;
      }
      writeRecord(span).draftComments.splice(index, 1);
      return true;
    },
    setChunkRead(span, chunkId, read) {
      const marks = writeRecord(span).readMarks;
      if (read) {
        marks.add(chunkId);
      } else {
        marks.delete(chunkId);
      }
    },
    reclassifyGroup(span, groupId, category) {
      writeRecord(span).reclassifications.set(groupId, {
        changeGroupId: groupId,
        category,
      });
    },
    dismissRisks(span, flags, reason) {
      const dispositions = writeRecord(span).dispositions;
      for (const flag of flags) {
        dispositions.set(buildFlagKey(flag), {
          id: issueId(DISPOSITION_ID_PREFIX),
          filePath: flag.filePath,
          attribute: flag.attribute,
          regionStart: flag.regionStart,
          regionEnd: flag.regionEnd,
          decision: DispositionDecisions.DISMISSED,
          reason,
          carryStatus: null,
          evidenceStatus: null,
          evidence: null,
          decidedAt: new Date().toISOString(),
        });
      }
      return flags.length;
    },
    addressRisks(span, flags) {
      const dispositions = writeRecord(span).dispositions;
      for (const flag of flags) {
        dispositions.set(buildFlagKey(flag), {
          id: issueId(DISPOSITION_ID_PREFIX),
          filePath: flag.filePath,
          attribute: flag.attribute,
          regionStart: flag.regionStart,
          regionEnd: flag.regionEnd,
          decision: DispositionDecisions.ADDRESSED,
          reason: null,
          carryStatus: null,
          evidenceStatus: null,
          evidence: { kind: flag.evidence.kind, ref: flag.evidence.ref },
          decidedAt: new Date().toISOString(),
        });
      }
      return flags.length;
    },
    reopenRisks(span, flags) {
      const dispositions = writeRecord(span).dispositions;
      const reopened = flags.filter((flag) =>
        dispositions.delete(buildFlagKey(flag)),
      );
      return reopened.length;
    },
    setOutcome(span, outcome) {
      writeRecord(span).reviewOutcome = outcome;
      return outcome;
    },
  };
}
