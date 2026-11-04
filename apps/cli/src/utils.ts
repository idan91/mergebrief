import { CliError, ExitCodes } from "./exit";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function buildSkewError(what: string): CliError {
  return new CliError(
    ExitCodes.GENERIC,
    `the server's ${what} response did not match the documented shape (version skew? check \`mergebrief auth status\`)`,
  );
}
