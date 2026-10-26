import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ScratchContainerName } from "../types";

const execFileAsync = promisify(execFile);

/** A full schema dump is under a megabyte; the limit only guards a runaway. */
const DUMP_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

/**
 * Lines pg_dump writes that describe the session or the dump, not the schema:
 * comments, `SET`, the `search_path` reset, the 17.6+ `\restrict` pair, and
 * the `public` schema itself, which every database already holds.
 */
const NOISE_LINE = new RegExp(
  [
    String.raw`^--`,
    String.raw`^SET\s`,
    String.raw`^SELECT pg_catalog\.set_config\(`,
    String.raw`^\\(un)?restrict\s`,
    String.raw`^CREATE SCHEMA public;$`,
    String.raw`^COMMENT ON SCHEMA public\s`,
  ].join("|"),
);

/** `pg_dump --schema-only` of the `public` schema, run inside the container
 * so the client version matches the server's. */
export async function dumpSchema(
  container: ScratchContainerName,
  database: string,
): Promise<string> {
  const { stdout } = await execFileAsync(
    "docker",
    [
      "exec",
      container,
      "pg_dump",
      "-U",
      "postgres",
      "--schema-only",
      "--no-owner",
      "--no-privileges",
      "--schema=public",
      "-d",
      database,
    ],
    { maxBuffer: DUMP_MAX_BUFFER_BYTES },
  );
  return stdout;
}

function isStatementLine(line: string): boolean {
  const isNoise = line.length === 0 || NOISE_LINE.test(line);
  return !isNoise;
}

/** The dump's statements only, one per line group, each kept byte for byte. */
export function normalizeDump(dump: string): string {
  const kept = dump.split("\n").filter(isStatementLine);
  if (kept.length === 0) {
    return "";
  }
  return `${kept.join("\n")}\n`;
}
