import type { Result } from "types/utils";

/** One package in the shipped graph, with the license expression pnpm resolved for it. */
export interface LicensedPackage {
  readonly name: string;
  readonly versions: readonly string[];
  readonly license: string;
}

/** A package allowed by name although its license is off the pass list. */
export interface LicenseException {
  readonly name: string;
  /** The exception lapses when the package's license changes. */
  readonly license: string;
  readonly reason: string;
}

export interface ExceptedPackage extends LicensedPackage {
  readonly reason: string;
}

export interface LicenseVerdict {
  readonly checked: number;
  readonly excepted: readonly ExceptedPackage[];
}

/** Lists the production dependency graph's licenses; injected so the command is testable without pnpm. */
export interface LicensesPort {
  listProductionLicenses(): string;
}

export interface LicensesCommandDeps {
  readonly port: LicensesPort;
  readonly writeOut: (text: string) => void;
  readonly writeError: (text: string) => void;
}

/** Where an SPDX expression stopped being well formed. */
export interface MalformedExpression {
  readonly position: number;
}

/** Whether an SPDX expression passes the pass list, or why it could not be read. */
export type ExpressionParse = Result<boolean, MalformedExpression>;
