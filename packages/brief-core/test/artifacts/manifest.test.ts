import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assignBriefIndex } from "../../src/artifacts/manifest";

describe("assignBriefIndex", () => {
  let dir: string;
  const stem = "owner-repo-1";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "briefs-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("assigns 1 to the first SHA and increments for new SHAs", async () => {
    expect(await assignBriefIndex(dir, stem, "aaaa1111")).toBe(1);
    expect(await assignBriefIndex(dir, stem, "bbbb2222")).toBe(2);
    expect(await assignBriefIndex(dir, stem, "cccc3333")).toBe(3);
  });

  it("is idempotent — a known SHA keeps its index", async () => {
    expect(await assignBriefIndex(dir, stem, "aaaa1111")).toBe(1);
    expect(await assignBriefIndex(dir, stem, "bbbb2222")).toBe(2);
    expect(await assignBriefIndex(dir, stem, "aaaa1111")).toBe(1);
    // a new SHA still takes the next ordinal, not a reused gap
    expect(await assignBriefIndex(dir, stem, "dddd4444")).toBe(3);
  });

  it("keeps separate sequences per PR stem", async () => {
    expect(await assignBriefIndex(dir, "owner-repo-1", "aaaa1111")).toBe(1);
    expect(await assignBriefIndex(dir, "owner-repo-2", "aaaa1111")).toBe(1);
  });
});
