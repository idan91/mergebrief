import type { StoredBrief } from "brief-core/artifact";
import type { ValueOf } from "types/utils";

/** Raw SQL for the script: `pg` in a real run, the in-memory database in tests. */
export interface SqlRunner {
  query(text: string, params: unknown[]): Promise<Record<string, unknown>[]>;
}

export interface NormalizeOptions {
  /** False counts what would change and writes nothing. */
  readonly apply: boolean;
}

export interface BriefCounts {
  scanned: number;
  rewritten: number;
  /** Left as stored: the reader refuses them, so no rewrite is safe. */
  unreadable: number;
}

export interface DeletionCounts {
  scanned: number;
  deleted: number;
}

export interface NormalizeSummary {
  readonly briefs: BriefCounts;
  readonly deltas: DeletionCounts;
  readonly narratives: DeletionCounts;
}

export interface StoredRow {
  readonly id: string;
  readonly body: string;
}

export const BriefReadKinds = {
  CURRENT: "current",
  LEGACY: "legacy",
  UNREADABLE: "unreadable",
} as const;
export type BriefReadKind = ValueOf<typeof BriefReadKinds>;

export type BriefRead =
  | {
      readonly kind: Exclude<BriefReadKind, typeof BriefReadKinds.LEGACY>;
    }
  | {
      readonly kind: typeof BriefReadKinds.LEGACY;
      readonly brief: StoredBrief;
    };

export interface StoredBodyReader {
  (body: string): { readonly ok: boolean };
}
