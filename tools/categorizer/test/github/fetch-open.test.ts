import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileAsync = vi.fn();

vi.mock("brief-core/gh-exec", () => ({
  execFileAsync: (...args: unknown[]) => execFileAsync(...args),
  MAX_BUFFER: 1024,
}));

const { fetchPrMetadata, OPEN_PR_LIST_LIMIT } =
  await import("../../src/github/fetch");

const LOC = { owner: "o", repo: "r", number: 13 };

const VIEW = {
  title: "Middle",
  body: "",
  url: "https://github.com/o/r/pull/13",
  headRefOid: "a".repeat(40),
  headRefName: "feature/b",
  headRepository: { name: "r" },
  headRepositoryOwner: { login: "o" },
  baseRefOid: "b".repeat(40),
  baseRefName: "feature/a",
  commits: [{}],
  files: [],
  state: "OPEN",
  isDraft: false,
};

function ghArgs(call: unknown): string[] {
  if (!Array.isArray(call)) {
    return [];
  }
  const args = call[1];
  return Array.isArray(args) ? args.map(String) : [];
}

function makeGhListRow(
  number: number,
  title: string,
  headRefName: string,
  baseRefName: string,
) {
  return {
    number,
    title,
    headRefName,
    baseRefName,
    headRepository: { name: LOC.repo },
    headRepositoryOwner: { login: LOC.owner },
  };
}

describe("fetchPrMetadata open-list stamp", () => {
  beforeEach(() => {
    execFileAsync.mockReset();
  });

  it("stamps a linear stack from gh pr list onto metadata", async () => {
    execFileAsync
      .mockResolvedValueOnce({ stdout: JSON.stringify(VIEW), stderr: "" })
      .mockResolvedValueOnce({
        stdout: JSON.stringify([
          makeGhListRow(12, "Bottom", "feature/a", "main"),
          makeGhListRow(13, "Middle", "feature/b", "feature/a"),
          makeGhListRow(14, "Tip", "feature/c", "feature/b"),
        ]),
        stderr: "",
      });

    const meta = await fetchPrMetadata(LOC);
    expect(meta.stack).toEqual({
      members: [
        { number: 12, title: "Bottom" },
        { number: 13, title: "Middle" },
        { number: 14, title: "Tip" },
      ],
      index: 2,
    });
    expect(ghArgs(execFileAsync.mock.calls[1])).toEqual(
      expect.arrayContaining([
        "pr",
        "list",
        "--state",
        "open",
        "--limit",
        String(OPEN_PR_LIST_LIMIT),
        "--json",
        "number,title,headRefName,baseRefName,isDraft,headRepository,headRepositoryOwner",
      ]),
    );
  });

  it("omits stack when gh pr list fails and still returns metadata", async () => {
    execFileAsync
      .mockResolvedValueOnce({ stdout: JSON.stringify(VIEW), stderr: "" })
      .mockRejectedValueOnce(new Error("gh: api failed"));

    const meta = await fetchPrMetadata(LOC);
    expect(meta.title).toBe("Middle");
    expect(meta.headRef).toBe("feature/b");
    expect(meta.baseRef).toBe("feature/a");
    expect("stack" in meta).toBe(false);
  });
});
