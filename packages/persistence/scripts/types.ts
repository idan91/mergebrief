export const MigrationVerdicts = {
  OK: "ok",
  MISSING_CONTRACTS_LINE: "missing-contracts-line",
} as const;

export type MigrationJudgment =
  | {
      readonly kind: typeof MigrationVerdicts.OK;
    }
  | {
      readonly kind: typeof MigrationVerdicts.MISSING_CONTRACTS_LINE;
      readonly statements: readonly string[];
    };

export interface MigrationOffender {
  readonly file: string;
  readonly statements: readonly string[];
}

export interface JournalEntry {
  readonly idx: number;
  readonly tag: string;
  readonly when: number;
}

export interface JournalOrderOffender {
  readonly tag: string;
  readonly when: number;
  readonly previousTag: string;
  readonly previousWhen: number;
}

export interface JournalIndexOffender {
  readonly tag: string;
  readonly idx: number;
  readonly expectedIdx: number;
}

export interface JournalOffenders {
  readonly order: readonly JournalOrderOffender[];
  readonly index: readonly JournalIndexOffender[];
}
