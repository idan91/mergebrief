// A real drizzle error through the log boundary. The logging package's own
// tests copy drizzle's error shape by hand, so a drizzle bump that changed
// the shape would pass them; this one would not.
import { DrizzleQueryError } from "drizzle-orm/errors";
import { createLogger, removeQueryParams } from "logging";
import { describe, expect, it } from "vitest";

const SQL = 'insert into "brief" ("body") values ($1)';
const BOUND_VALUE = "PRIVATE-BRIEF-BODY";

function makeQueryError(): DrizzleQueryError {
  const driverError = Object.assign(new Error("duplicate key value"), {
    detail: `Key (body)=(${BOUND_VALUE}) already exists.`,
  });
  return new DrizzleQueryError(SQL, [BOUND_VALUE], driverError);
}

describe("a drizzle query error at the log boundary", () => {
  it("is copied without the values it bound", () => {
    const copy = removeQueryParams(makeQueryError());

    expect(copy).toBeInstanceOf(DrizzleQueryError);
    expect(copy).toMatchObject({ message: `Failed query: ${SQL}` });
    expect(copy).not.toHaveProperty("params");
    expect(String((copy as Error).stack)).not.toContain(BOUND_VALUE);
  });

  it("is logged with its statement and none of its values", () => {
    const lines: string[] = [];
    const destination = {
      write(line: string): void {
        lines.push(line);
      },
    };
    const logger = createLogger({ env: {}, destination });

    logger.error("write failed", { err: makeQueryError() });

    const written = lines.join("");
    expect(written).toContain("Failed query");
    expect(written).not.toContain(BOUND_VALUE);
  });
});
