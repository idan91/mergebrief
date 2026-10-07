import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import { z } from "zod/v4";

/** The request URL, whatever shape `fetch` was handed. */
export function getRequestUrl(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

const ShimCwdRecordSchema = z.object({
  argv: z.array(z.string()),
  cwd: z.string(),
  entries: z.array(z.string()),
});

/** One shim invocation as `SHIM_CWD_LOG` recorded it, read during the run. */
export type ShimCwdRecord = z.infer<typeof ShimCwdRecordSchema>;

/** Every invocation a shim appended to its `SHIM_CWD_LOG` file, in order. */
export function readShimCwdLog(file: string): ShimCwdRecord[] {
  const text = readFileSync(file, "utf8");
  const lines = text.trim().split("\n");
  const records: ShimCwdRecord[] = [];
  for (const line of lines) {
    const value: unknown = JSON.parse(line);
    records.push(ShimCwdRecordSchema.parse(value));
  }
  return records;
}

/**
 * Asserts every recorded spawn ran in a temp dir named by `prefix`, under the
 * home cache rather than the shared temp dir, that was empty while the CLI
 * ran and is gone now; returns the records.
 */
export function expectEmptyRemovedCwds(
  file: string,
  prefix: string,
): ShimCwdRecord[] {
  const records = readShimCwdLog(file);
  const home = realpathSync(homedir());
  const harnessBase = join(home, ".cache", "mergebrief");
  expect(records.length).toBeGreaterThan(0);
  for (const record of records) {
    expect(record.cwd).toContain(prefix);
    expect(record.cwd.startsWith(harnessBase)).toBe(true);
    expect(record.cwd).not.toBe(process.cwd());
    expect(record.entries).toEqual([]);
    expect(existsSync(record.cwd)).toBe(false);
  }
  return records;
}
