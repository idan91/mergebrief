import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileAsync = vi.fn();

vi.mock("brief-core/gh-exec", () => ({
  execFileAsync: (...args: unknown[]) => execFileAsync(...args),
  MAX_BUFFER: 1024,
}));

const { fetchCommitDate } = await import("../../src/github/fetch");

const LOC = { owner: "o", repo: "r", number: 7 };
const SHA = "b".repeat(40);

describe("fetchCommitDate", () => {
  beforeEach(() => {
    execFileAsync.mockReset();
  });

  it("reads the commit's committer date", async () => {
    execFileAsync.mockResolvedValue({ stdout: "2026-10-01T12:00:00Z\n" });

    const date = await fetchCommitDate(LOC, SHA);

    expect(date).toBe("2026-10-01T12:00:00Z");
    const [, args] = execFileAsync.mock.calls[0] ?? [];
    expect(args).toEqual([
      "api",
      `repos/o/r/commits/${SHA}`,
      "--jq",
      ".commit.committer.date",
    ]);
  });

  it("refuses a ref that is not a commit SHA", async () => {
    await expect(fetchCommitDate(LOC, "main")).rejects.toThrow("main");
    expect(execFileAsync).not.toHaveBeenCalled();
  });

  it("throws when gh prints no timestamp", async () => {
    execFileAsync.mockResolvedValue({ stdout: "null\n" });

    await expect(fetchCommitDate(LOC, SHA)).rejects.toThrow(SHA);
  });
});
