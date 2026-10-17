// `disposition`: an anchored reviewer decision on a risk-surface flag, owned
// by the Review Session it was made in. Anchored by content coordinates
// (file/attribute/region), never a brief-local id, since those dangle on
// regeneration. Current shape covers only region-anchored flags (region NOT
// NULL). No `decided_at_sha`, `pull_request_id` or `reviewer_id`: the session
// carries all three, and the erasure cascade reaches `pull_request` through it.
import {
  bigint,
  check,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import type { ReviewSessionId } from "../types";
import {
  DispositionCarryStatuses,
  DispositionDecisions,
  DispositionEvidenceKinds,
  DispositionEvidenceStatuses,
  type DispositionCarryStatus,
  type DispositionDecision,
  type DispositionEvidenceKind,
  type DispositionEvidenceStatus,
} from "types/dispositions";
import { isNullOrOneOf, isOneOf } from "./checks";
import { tenantColumns } from "./columns";
import { reviewSession } from "./review-session";

const DISPOSITION_DECISIONS = Object.values(DispositionDecisions);
const DISPOSITION_CARRY_STATUSES = Object.values(DispositionCarryStatuses);
const DISPOSITION_EVIDENCE_STATUSES = Object.values(
  DispositionEvidenceStatuses,
);
const DISPOSITION_EVIDENCE_KINDS = Object.values(DispositionEvidenceKinds);

export const disposition = pgTable(
  "disposition",
  {
    ...tenantColumns(),
    reviewSessionId: bigint("review_session_id", { mode: "bigint" })
      .$type<ReviewSessionId>()
      .notNull()
      .references(() => reviewSession.id, { onDelete: "cascade" }),
    /** Canonical within an artifact; not rename-stable. */
    filePath: text("file_path").notNull(),
    /** The risk-surface attribute token: the Flag's identity. */
    attribute: text("attribute").notNull(),
    regionStart: integer("region_start").notNull(),
    regionEnd: integer("region_end").notNull(),
    decision: text("decision").$type<DispositionDecision>().notNull(),
    /** How the row reached this session; null = decided here. CHECK-constrained. */
    carryStatus: text("carry_status").$type<DispositionCarryStatus>(),
    /** Null = the evidence the decision claimed still stands. CHECK-constrained. */
    evidenceStatus: text("evidence_status").$type<DispositionEvidenceStatus>(),
    /** What an addressing decision points at; null on a dismissal. CHECK-constrained. */
    evidenceKind: text("evidence_kind").$type<DispositionEvidenceKind>(),
    /** Reads per `evidence_kind`: a draft row id, a Chunk id, or the note. */
    evidenceRef: text("evidence_ref"),
    /** Dismissal reason, verbatim on the Receipt; null if addressed. */
    reason: text("reason"),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("disposition_natural_key").on(
      table.reviewSessionId,
      table.filePath,
      table.attribute,
      table.regionStart,
      table.regionEnd,
    ),
    check(
      "disposition_decision_check",
      isOneOf(table.decision, DISPOSITION_DECISIONS),
    ),
    check(
      "disposition_carry_status_check",
      isNullOrOneOf(table.carryStatus, DISPOSITION_CARRY_STATUSES),
    ),
    check(
      "disposition_evidence_status_check",
      isNullOrOneOf(table.evidenceStatus, DISPOSITION_EVIDENCE_STATUSES),
    ),
    check(
      "disposition_evidence_kind_check",
      isNullOrOneOf(table.evidenceKind, DISPOSITION_EVIDENCE_KINDS),
    ),
  ],
);
