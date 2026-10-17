// Several scopes in one call is for the Inbox list only. Every other store
// resolves ONE scope through `resolveScope`; this reads the store sources
// and refuses a second file that composes an installation set in either
// spelling this package uses, the drizzle `inArray` or a raw SQL `in`.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const STORES_DIR = fileURLToPath(new URL("../src/stores", import.meta.url));
const MULTI_SCOPE_MARKS = [
  "inArray(pullRequest.installationId",
  "installation_id in (",
  "installationId in (",
];

describe("multi-scope reads", () => {
  it("only the Inbox store composes several installations", () => {
    const composing = readdirSync(STORES_DIR, { recursive: true })
      .map(String)
      .filter((name) => name.endsWith(".ts"))
      .filter((name) => {
        const source = readFileSync(join(STORES_DIR, name), "utf8");
        return MULTI_SCOPE_MARKS.some((mark) => source.includes(mark));
      });

    expect(composing).toEqual(["inbox.ts"]);
  });
});
