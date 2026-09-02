import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LOCAL_SETTINGS_PATH, readLocalTracker } from "../../src/cli/settings";

let cwd: string;
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "mb-settings-"));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

async function writeSettings(content: string): Promise<void> {
  await mkdir(join(cwd, ".mergebrief"), { recursive: true });
  await writeFile(join(cwd, LOCAL_SETTINGS_PATH), content);
}

describe("readLocalTracker", () => {
  it("is silent when the working tree has no settings file", () => {
    expect(readLocalTracker(cwd)).toEqual({ tracker: undefined });
  });

  it("reads the tracker block and ignores other keys", async () => {
    await writeSettings(
      "version: 1\nentryCommentOnDrafts: true\ntracker:\n  kind: notion\n  keyPrefix: BRIEF\n  databaseId: 3935e9400eeb80b0ad46000b1ce17b37\n",
    );
    expect(readLocalTracker(cwd)).toEqual({
      tracker: {
        kind: "notion",
        keyPrefix: "BRIEF",
        databaseId: "3935e9400eeb80b0ad46000b1ce17b37",
      },
    });
  });

  it("yields no tracker when the file has none", async () => {
    await writeSettings("version: 1\n");
    expect(readLocalTracker(cwd)).toEqual({ tracker: undefined });
  });

  it("warns and yields no tracker on an invalid block", async () => {
    await writeSettings("version: 1\ntracker:\n  kind: jira\n");
    const read = readLocalTracker(cwd);
    expect(read.tracker).toBeUndefined();
    expect(read.warning).toContain("invalid");
  });

  it("warns and yields no tracker on an unknown version", async () => {
    await writeSettings("version: 2\ntracker:\n  kind: github\n");
    expect(readLocalTracker(cwd).warning).toContain("invalid");
  });

  it("warns on unparseable YAML without echoing the file", async () => {
    await writeSettings("version: [1\nsecret: hunter2");
    const read = readLocalTracker(cwd);
    expect(read.tracker).toBeUndefined();
    expect(read.warning).toContain("not valid YAML");
    expect(read.warning).not.toContain("hunter2");
  });
});
