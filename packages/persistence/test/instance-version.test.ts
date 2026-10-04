// The one-row `instance_version` table the boot boundary writes: first boot
// records the running version; a newer one logs the upgrade; an older one
// warns that the database is ahead and still records; a dev build never
// replaces a real version.
import { createLogger, type Logger } from "logging";
import { describe, expect, it } from "vitest";
import {
  recordInstanceVersionWith,
  type VersionQueryExecutor,
} from "../src/db/instance-version";
import { freshPglite } from "./helpers";

interface CapturedLine {
  [key: string]: unknown;
}

interface Logging {
  readonly log: Logger;
  lines(): CapturedLine[];
}

function isRecord(value: unknown): value is CapturedLine {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stubLogging(): Logging {
  const written: string[] = [];
  const log = createLogger({
    env: { LOG_LEVEL: "debug" },
    destination: { write: (line: string) => void written.push(line) },
  });
  return {
    log,
    lines: () =>
      written.map((line) => {
        const parsed: unknown = JSON.parse(line);
        if (!isRecord(parsed)) {
          throw new Error(`expected an NDJSON object line, got: ${line}`);
        }
        return parsed;
      }),
  };
}

async function makeExecutor(): Promise<VersionQueryExecutor> {
  const client = await freshPglite();
  return async (sql, params) =>
    (await client.query<Record<string, unknown>>(sql, [...params])).rows;
}

async function readRow(executor: VersionQueryExecutor) {
  const rows = await executor("select id, version from instance_version", []);
  return rows;
}

describe("recordInstanceVersion", () => {
  it("writes the running version on first boot", async () => {
    const executor = await makeExecutor();
    const { log, lines } = stubLogging();

    await recordInstanceVersionWith(executor, "1.4.0", log);

    expect(await readRow(executor)).toEqual([{ id: true, version: "1.4.0" }]);
    expect(lines()).toEqual([]);
  });

  it("logs db.version.upgrade when a newer version boots", async () => {
    const executor = await makeExecutor();
    const { log, lines } = stubLogging();
    await recordInstanceVersionWith(executor, "1.4.0", log);

    await recordInstanceVersionWith(executor, "1.5.0", log);

    expect(await readRow(executor)).toEqual([{ id: true, version: "1.5.0" }]);
    expect(lines()).toEqual([
      expect.objectContaining({
        evt: "db.version.upgrade",
        level: "info",
        from: "1.4.0",
        to: "1.5.0",
      }),
    ]);
  });

  it("warns db.version.ahead and still records when an older version boots", async () => {
    const executor = await makeExecutor();
    const { log, lines } = stubLogging();
    await recordInstanceVersionWith(executor, "1.5.0", log);

    await recordInstanceVersionWith(executor, "1.4.0", log);

    expect(await readRow(executor)).toEqual([{ id: true, version: "1.4.0" }]);
    expect(lines()).toEqual([
      expect.objectContaining({
        evt: "db.version.ahead",
        level: "warn",
        db: "1.5.0",
        running: "1.4.0",
      }),
    ]);
  });

  it("stays silent when the version is unchanged", async () => {
    const executor = await makeExecutor();
    const { log, lines } = stubLogging();
    await recordInstanceVersionWith(executor, "1.4.0", log);

    await recordInstanceVersionWith(executor, "1.4.0", log);

    expect(lines()).toEqual([]);
  });

  it("keeps a real version when a dev build boots in between", async () => {
    const executor = await makeExecutor();
    const { log, lines } = stubLogging();
    await recordInstanceVersionWith(executor, "1.4.0", log);

    await recordInstanceVersionWith(executor, "dev", log);
    await recordInstanceVersionWith(executor, "0.0.0", log);
    await recordInstanceVersionWith(executor, "v0.0.0", log);
    expect(await readRow(executor)).toEqual([{ id: true, version: "1.4.0" }]);
    expect(lines()).toEqual([]);
    await recordInstanceVersionWith(executor, "1.5.0", log);

    expect(await readRow(executor)).toEqual([{ id: true, version: "1.5.0" }]);
    expect(lines()).toEqual([
      expect.objectContaining({
        evt: "db.version.upgrade",
        from: "1.4.0",
        to: "1.5.0",
      }),
    ]);
  });

  it("records a dev build on an empty row and over another dev build", async () => {
    const executor = await makeExecutor();
    const { log, lines } = stubLogging();

    await recordInstanceVersionWith(executor, "dev", log);
    await recordInstanceVersionWith(executor, "0.0.0", log);

    expect(await readRow(executor)).toEqual([{ id: true, version: "0.0.0" }]);
    expect(lines()).toEqual([]);
  });

  it("warns and still returns ok when the row cannot be written", async () => {
    const { log, lines } = stubLogging();
    const executor: VersionQueryExecutor = async (sql) => {
      if (sql.startsWith("insert")) {
        throw new Error("permission denied for table instance_version");
      }
      return [];
    };

    await recordInstanceVersionWith(executor, "1.4.0", log);

    expect(lines()).toEqual([
      expect.objectContaining({
        level: "warn",
        running: "1.4.0",
        msg: "instance version was not recorded",
      }),
    ]);
  });

  it("keeps a single row under the id check", async () => {
    const executor = await makeExecutor();
    const { log } = stubLogging();
    await recordInstanceVersionWith(executor, "1.4.0", log);

    await expect(
      executor(
        "insert into instance_version (id, version) values (false, '9.9.9')",
        [],
      ),
    ).rejects.toThrow(/check/i);
  });
});
