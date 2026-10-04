import type { ValueOf } from "types/utils";

export const MigrationVerdicts = {
  OK: "ok",
  GRANDFATHERED: "grandfathered",
  MISSING_CONTRACTS_LINE: "missing-contracts-line",
} as const;
export type MigrationVerdict = ValueOf<typeof MigrationVerdicts>;

export type MigrationJudgment =
  | {
      readonly kind: Exclude<
        MigrationVerdict,
        typeof MigrationVerdicts.MISSING_CONTRACTS_LINE
      >;
    }
  | {
      readonly kind: typeof MigrationVerdicts.MISSING_CONTRACTS_LINE;
      readonly statements: readonly string[];
    };

export interface MigrationOffender {
  readonly file: string;
  readonly statements: readonly string[];
}
