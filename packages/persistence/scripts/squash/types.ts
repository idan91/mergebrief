import type { generateDrizzleJson } from "drizzle-kit/api";
import type { ValueOf } from "types/utils";

/** drizzle-kit's own snapshot shape; the kit does not export it by name. */
export type BaselineSnapshot = ReturnType<typeof generateDrizzleJson>;

/** `startPostgres` stamps its container with the run's pid. */
export type ScratchContainerName = `mergebrief-squash-${number}`;
export type ScratchPostgresUrl = `postgres://${string}`;

export const SquashModes = {
  CHECK: "check",
  WRITE: "write",
} as const;
export type SquashMode = ValueOf<typeof SquashModes>;

export const SquashOutcomes = {
  PROOF_FAILED: "proof-failed",
  CHECKED: "checked",
  WRITTEN: "written",
} as const;
export type SquashOutcome = ValueOf<typeof SquashOutcomes>;

export const ProofStepNames = {
  DUMP_DIFF: "dump-diff",
  LEDGER_CONTINUITY: "ledger-continuity",
  BEHIND_TIP_REFUSAL: "behind-tip-refusal",
  PGLITE_APPLY: "pglite-apply",
  GENERATE_CLEAN: "generate-clean",
  CONTRACTS_GATE: "contracts-gate",
} as const;
export type ProofStepName = ValueOf<typeof ProofStepNames>;

export interface ProofStep {
  readonly name: ProofStepName;
  readonly ok: boolean;
  /** One line when ok; the evidence (diff, error, file list) when not. */
  readonly detail: string;
}

export interface ProofReport {
  readonly ok: boolean;
  readonly steps: readonly ProofStep[];
}

/** `drizzle.__drizzle_migrations` reduced to what the ledger leg compares. */
export interface LedgerState {
  readonly rows: number;
  readonly latest: number;
}

/** The journal entry shape drizzle's migrator reads (`meta/_journal.json`). */
export interface JournalEntry {
  readonly idx: number;
  readonly version: string;
  readonly when: number;
  readonly tag: string;
  readonly breakpoints: boolean;
}

export interface Journal {
  readonly version: string;
  readonly dialect: string;
  readonly entries: readonly JournalEntry[];
}

/** The three files a squashed `drizzle/` folder holds. */
export interface SquashedFolder {
  readonly dir: string;
  readonly sqlFile: string;
  readonly journalFile: string;
  readonly snapshotFile: string;
}

export interface SnapshotComparison {
  readonly equal: boolean;
  /** Dot paths that differ, `id` and `prevId` excluded. */
  readonly drift: readonly string[];
}

export interface ProofInputs {
  readonly postgres: ScratchPostgres;
  /** The chain copy the scratch `chain` database was migrated from. */
  readonly chainDir: string;
  /** Connection string of the database at the chain tip. */
  readonly chainUrl: ScratchPostgresUrl;
  /** The normalized dump of that database. */
  readonly chainDump: string;
  readonly squashed: SquashedFolder;
  /** `packages/persistence`: drizzle-kit's bin and the schema folder. */
  readonly packageDir: string;
  /** Scratch space for the behind copy, the diff files and the kit config. */
  readonly scratchDir: string;
}

export interface ScratchPostgres {
  readonly container: ScratchContainerName;
  readonly port: number;
  /** Connection string for `database`, with the throwaway password. */
  getDatabaseUrl(database: string): ScratchPostgresUrl;
  stop(): Promise<void>;
}
