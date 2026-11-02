import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileAsync = vi.fn();

vi.mock("brief-core/gh-exec", () => ({
  execFileAsync: (...args: unknown[]) => execFileAsync(...args),
  MAX_BUFFER: 1024,
}));

const { buildGhPrSpanSource } = await import("../../src/github/span-source");

const LOC = { owner: "o", repo: "r", number: 13 };
const SPAN = { base: "a".repeat(40), head: "b".repeat(40) };
const BLOB = { path: "src/a b.ts", ref: "c".repeat(40), maxBytes: 100 };

function stubGhFailure(status: number | undefined): Error {
  const suffix = status === undefined ? "" : ` (HTTP ${status})`;
  return Object.assign(new Error("gh failed"), {
    stderr: `gh: request failed${suffix}`,
  });
}

function stubContents(fields: Record<string, unknown>): { stdout: string } {
  return {
    stdout: JSON.stringify({ type: "file", encoding: "base64", ...fields }),
  };
}

function encode(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

describe("buildGhPrSpanSource fetchPrDiff", () => {
  beforeEach(() => {
    execFileAsync.mockReset();
  });

  it("reads the PR diff from the compare endpoint", async () => {
    execFileAsync.mockResolvedValue({ stdout: "diff text" });
    const source = buildGhPrSpanSource(LOC);

    const read = await source.fetchPrDiff(SPAN, new AbortController().signal);

    expect(read).toEqual({ ok: true, value: "diff text" });
    const [, args] = execFileAsync.mock.calls[0] ?? [];
    expect(args).toContain(`repos/o/r/compare/${SPAN.base}...${SPAN.head}`);
  });

  it.each([
    [406, "too-large"],
    [422, "too-large"],
    [404, "unavailable"],
    [403, "unavailable"],
    [502, "transient"],
    [undefined, "transient"],
  ])("maps a gh failure with status %s to %s", async (status, kind) => {
    execFileAsync.mockRejectedValue(stubGhFailure(status));
    const source = buildGhPrSpanSource(LOC);

    const read = await source.fetchPrDiff(SPAN, new AbortController().signal);

    expect(read).toEqual({ ok: false, error: { kind } });
  });

  it("rejects with the abort reason once the signal aborts", async () => {
    const controller = new AbortController();
    const reason = new Error("superseded");
    execFileAsync.mockImplementation(() => {
      controller.abort(reason);
      return Promise.reject(stubGhFailure(undefined));
    });
    const source = buildGhPrSpanSource(LOC);

    await expect(source.fetchPrDiff(SPAN, controller.signal)).rejects.toBe(
      reason,
    );
  });
});

describe("buildGhPrSpanSource fetchBlob", () => {
  beforeEach(() => {
    execFileAsync.mockReset();
  });

  it("decodes a text file read at the ref", async () => {
    execFileAsync.mockResolvedValue(
      stubContents({ size: 6, content: encode("hello\n") }),
    );
    const source = buildGhPrSpanSource(LOC);

    const read = await source.fetchBlob(BLOB, new AbortController().signal);

    expect(read).toEqual({
      ok: true,
      value: { kind: "text", content: "hello\n" },
    });
    const [, args] = execFileAsync.mock.calls[0] ?? [];
    expect(args).toContain(`repos/o/r/contents/src/a%20b.ts?ref=${BLOB.ref}`);
  });

  it("reads a 404 as no file at that path", async () => {
    execFileAsync.mockRejectedValue(stubGhFailure(404));
    const source = buildGhPrSpanSource(LOC);

    const read = await source.fetchBlob(BLOB, new AbortController().signal);

    expect(read).toEqual({ ok: true, value: { kind: "absent" } });
  });

  it.each([
    ["a file past the byte bound", { size: 101, content: encode("x") }],
    ["a submodule", { type: "submodule", size: 0 }],
    [
      "a file GitHub would not inline",
      { size: 9, encoding: "none", content: "" },
    ],
    ["bytes that are not UTF-8", { size: 2, content: "//4=" }],
  ])("reads %s as unreadable", async (_label, fields) => {
    execFileAsync.mockResolvedValue(stubContents(fields));
    const source = buildGhPrSpanSource(LOC);

    const read = await source.fetchBlob(BLOB, new AbortController().signal);

    expect(read).toEqual({ ok: true, value: { kind: "unreadable" } });
  });

  it("reads a directory listing as unreadable", async () => {
    execFileAsync.mockResolvedValue({ stdout: "[]" });
    const source = buildGhPrSpanSource(LOC);

    const read = await source.fetchBlob(BLOB, new AbortController().signal);

    expect(read).toEqual({ ok: true, value: { kind: "unreadable" } });
  });

  it("reads contents output that is not JSON as a transient failure", async () => {
    execFileAsync.mockResolvedValue({ stdout: "<html>busy</html>" });
    const source = buildGhPrSpanSource(LOC);

    const read = await source.fetchBlob(BLOB, new AbortController().signal);

    expect(read).toEqual({ ok: false, error: { kind: "transient" } });
  });

  it("maps any other blob read failure like a diff read", async () => {
    execFileAsync.mockRejectedValue(stubGhFailure(500));
    const source = buildGhPrSpanSource(LOC);

    const read = await source.fetchBlob(BLOB, new AbortController().signal);

    expect(read).toEqual({ ok: false, error: { kind: "transient" } });
  });
});
