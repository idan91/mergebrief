import { describe, expect, it } from "vitest";
import { collectKnownCommits } from "./known-commits";

const PR_BASE = "1".repeat(40);
const PR_HEAD = "2".repeat(40);
const BRIEF_BASE = "3".repeat(40);
const BRIEF_HEAD = "4".repeat(40);
const DELTA_BASELINE = "5".repeat(40);
const DELTA_HEAD = "6".repeat(40);

describe("collectKnownCommits", () => {
  it("collects the row, Brief span and Delta span commits", () => {
    const known = collectKnownCommits(
      { baseSha: PR_BASE, githubHeadSha: PR_HEAD },
      [{ baseSha: BRIEF_BASE, headSha: BRIEF_HEAD }],
      [{ baselineSha: DELTA_BASELINE, headSha: DELTA_HEAD }],
    );

    expect([...known].toSorted()).toEqual([
      PR_BASE,
      PR_HEAD,
      BRIEF_BASE,
      BRIEF_HEAD,
      DELTA_BASELINE,
      DELTA_HEAD,
    ]);
  });

  it("skips the commits the row has not recorded", () => {
    const known = collectKnownCommits(
      { baseSha: null, githubHeadSha: null },
      [],
      [],
    );

    expect(known.size).toBe(0);
  });

  it("holds a commit shared by several spans once", () => {
    const known = collectKnownCommits(
      { baseSha: PR_BASE, githubHeadSha: PR_HEAD },
      [
        { baseSha: PR_BASE, headSha: BRIEF_HEAD },
        { baseSha: PR_BASE, headSha: PR_HEAD },
      ],
      [{ baselineSha: BRIEF_HEAD, headSha: PR_HEAD }],
    );

    expect([...known].toSorted()).toEqual([PR_BASE, PR_HEAD, BRIEF_HEAD]);
  });
});
