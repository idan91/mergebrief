import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  describeUnreadPrimary,
  readContextFile,
} from "../../src/cli/context-file";
import { extractContextFlag } from "../../src/cli/config";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mb-context-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function write(name: string, content: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}

describe("extractContextFlag", () => {
  it("pulls --context <file> out of argv", () => {
    expect(extractContextFlag(["--context", "t.json", "url"])).toEqual({
      contextPath: "t.json",
      rest: ["url"],
    });
    expect(extractContextFlag(["url"])).toEqual({
      contextPath: null,
      rest: ["url"],
    });
  });

  it("rejects a missing or flag-shaped value", () => {
    expect(extractContextFlag(["--context"])).toBeNull();
    expect(extractContextFlag(["--context", "--out", "x"])).toBeNull();
  });
});

describe("readContextFile", () => {
  it("reads the minimal shape with defaults", async () => {
    const path = await write(
      "t.json",
      JSON.stringify({ url: "https://tasks.example/DS-42", content: "Body" }),
    );
    expect(readContextFile(path)).toEqual({
      ok: true,
      value: {
        providerId: "url",
        source: "https://tasks.example/DS-42",
        text: "Body",
        tracker: "github",
        key: "",
        title: "",
        header: "",
        foundIn: "description",
      },
    });
  });

  it("carries key, tracker, title and header", async () => {
    const path = await write(
      "t.json",
      JSON.stringify({
        url: "https://www.notion.so/abc",
        key: "BRIEF-1",
        tracker: "notion",
        title: "T",
        header: "Status: Now",
        content: "Body",
      }),
    );
    const read = readContextFile(path);
    expect(read.ok && read.value).toMatchObject({
      key: "BRIEF-1",
      tracker: "notion",
      title: "T",
      header: "Status: Now",
    });
  });

  it("accepts a jira ticket", async () => {
    const path = await write(
      "t.json",
      JSON.stringify({
        url: "https://acme.atlassian.net/browse/ACME-12",
        key: "ACME-12",
        tracker: "jira",
        content: "Body",
      }),
    );
    const read = readContextFile(path);
    expect(read.ok && read.value).toMatchObject({
      key: "ACME-12",
      tracker: "jira",
    });
  });

  it.each([
    ["an unreadable path", null],
    ["invalid JSON", "{"],
    ["a missing content", JSON.stringify({ url: "https://x" })],
    [
      "an unknown key",
      JSON.stringify({ url: "https://x", content: "b", extra: 1 }),
    ],
    [
      "an unknown tracker",
      JSON.stringify({ url: "https://x", content: "b", tracker: "linear" }),
    ],
  ])("fails on %s", async (_label, content) => {
    const path =
      content === null
        ? join(dir, "missing.json")
        : await write("t.json", content);
    expect(readContextFile(path)).toEqual({
      ok: false,
      error: expect.stringContaining("--context"),
    });
  });
});

describe("describeUnreadPrimary", () => {
  it("renders the key, the code and the catalog sentence", () => {
    expect(
      describeUnreadPrimary({
        key: "BRIEF-1",
        url: "https://www.notion.so/abc",
        tracker: "notion",
        foundIn: "description",
        title: "",
        header: "",
        status: "unread",
        reason: "not-found",
      }),
    ).toBe(
      "error: BRIEF-1 could not be read (not-found); Notion returned not found. The page was moved, or the integration has no access to it",
    );
  });

  it("falls back to the URL when the key is empty", () => {
    expect(
      describeUnreadPrimary({
        key: "",
        url: "https://github.com/o/r/issues/7",
        tracker: "github",
        foundIn: "branch",
        title: "",
        header: "",
        status: "unread",
        reason: "unsupported",
      }),
    ).toBe(
      "error: https://github.com/o/r/issues/7 could not be read (unsupported); no GitHub reader is configured on this deployment",
    );
  });
});
