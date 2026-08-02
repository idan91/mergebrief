// The brief.repo_config artifact contract (ADR 0032 #8/#11): the read
// boundary must reject snapshots that could not have come from the writer —
// wrong/reordered/duplicated slot paths, unconstrained fired definitions,
// floor attributes in deEmphasize (codex PR 4 round 1).
import { describe, expect, it } from "vitest";
import { FLOOR_ATTRIBUTES, RepoConfigPaths } from "../src/constants";
import { repoConfigArtifactSchema } from "../src/provenance";

const APPLIED = (path: string) => ({
  path,
  blobSha: "abc",
  outcome: "applied",
});
const CANONICAL = [
  APPLIED(RepoConfigPaths.INSTRUCTIONS),
  APPLIED(RepoConfigPaths.SETTINGS),
  APPLIED(RepoConfigPaths.POLICY),
];

function artifact(overrides: Record<string, unknown> = {}) {
  return { files: CANONICAL, collisions: [], policy: null, ...overrides };
}

describe("repoConfigArtifactSchema — slot tuple", () => {
  it("accepts the canonical three-slot table", () => {
    expect(repoConfigArtifactSchema.safeParse(artifact()).success).toBe(true);
  });

  it.each([
    ["empty", []],
    ["missing a slot", CANONICAL.slice(0, 2)],
    ["reordered", [CANONICAL[1], CANONICAL[0], CANONICAL[2]]],
    ["duplicated", [CANONICAL[0], CANONICAL[0], CANONICAL[2]]],
    [
      "foreign path",
      [CANONICAL[0], CANONICAL[1], APPLIED(".mergebrief/evil.yaml")],
    ],
  ])("rejects a %s files table", (_label, files) => {
    expect(
      repoConfigArtifactSchema.safeParse(artifact({ files })).success,
    ).toBe(false);
  });
});

describe("repoConfigArtifactSchema — policy snapshot constraints", () => {
  function withPolicy(policy: unknown) {
    return artifact({ policy });
  }

  it("accepts a validated-shaped snapshot", () => {
    const parsed = repoConfigArtifactSchema.safeParse(
      withPolicy({
        firedCustomAttributes: [
          {
            name: "touches-billing",
            criteria: "c",
            implication: "i",
            paths: ["a/**"],
          },
        ],
        deEmphasize: [{ attribute: "widens-error-handling" }],
      }),
    );
    expect(parsed.success).toBe(true);
  });

  it.each([
    ["off-charset name", { name: "Bad Name", criteria: "c" }],
    ["empty criteria", { name: "ok-name", criteria: "" }],
    ["over-cap criteria", { name: "ok-name", criteria: "x".repeat(4001) }],
    [
      "over-cap implication",
      { name: "ok-name", criteria: "c", implication: "x".repeat(501) },
    ],
    ["over-cap name", { name: "x".repeat(51), criteria: "c" }],
    ["empty path glob", { name: "ok-name", criteria: "c", paths: [""] }],
  ])("rejects a fired definition with %s", (_label, fired) => {
    const parsed = repoConfigArtifactSchema.safeParse(
      withPolicy({ firedCustomAttributes: [fired], deEmphasize: [] }),
    );
    expect(parsed.success).toBe(false);
  });

  it.each([...FLOOR_ATTRIBUTES])(
    "rejects a stored snapshot de-emphasizing floor attribute %s",
    (floor) => {
      const parsed = repoConfigArtifactSchema.safeParse(
        withPolicy({
          firedCustomAttributes: [],
          deEmphasize: [{ attribute: floor }],
        }),
      );
      expect(parsed.success).toBe(false);
    },
  );
});
