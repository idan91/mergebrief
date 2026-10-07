import { describe, expect, it } from "vitest";
import {
  createArtifactStore,
  createGenerationProjection,
  type PullRequestRow,
} from "persistence";
import { GenerationStatuses } from "types/generations";
import { RepoConfigPaths, repoConfigArtifactSchema } from "repo-config";
import {
  BASE,
  buildRepoFile,
  ctx,
  harness,
  HEAD_1,
  makeTarget,
  makeTask,
  setUpHarness,
  stubGenerator,
  stubGitHub,
  trigger,
} from "./helpers";

setUpHarness();

describe("generate task, repo-config phase", () => {
  const POLICY_YAML = `version: 1
attributes:
  touches-billing:
    criteria: modifies invoicing code
    implication: needs finance review
deEmphasize:
  - attribute: widens-error-handling
`;
  const SETTINGS_YAML = "version: 1\nentryCommentOnDrafts: true\n";
  const INSTRUCTIONS_MD = "Call the invoicing engine 'the biller'.";

  /** A brief output whose one chunk fires the repo-defined attribute. */
  const FIRING_BRIEF = {
    summary: "stub brief",
    intentCheck: {
      ticketUrls: [],
      ticketTitles: [],
      specificity: "none",
      scopeNote: "",
      items: [],
      alignment: { read: "", goal: "", response: "" },
    },
    changeGroups: [
      {
        id: "g1",
        title: "billing",
        summary: "s",
        dominantCategory: "new-feature",
        secondaryCategories: [],
        uncertain: false,
        uncertainBetween: [],
      },
    ],
    chunks: [
      {
        id: "c1",
        changeGroupId: "g1",
        file: "a.ts",
        concern: "implementation",
        role: "core",
        loc: { added: 1, deleted: 0 },
        addedRanges: [{ start: 2, end: 2 }],
        removedRanges: [],
        riskSurface: ["touches-billing"],
      },
    ],
    concernView: [{ concern: "implementation", added: 1, deleted: 0 }],
  };

  async function readStoredRepoConfig(pr: PullRequestRow, headSha: string) {
    const brief = await createArtifactStore(harness.handle, ctx).briefs.get(
      pr.id,
      BASE,
      headSha,
    );
    expect(brief?.repoConfig).toBeTruthy();
    const parsed: unknown = JSON.parse(brief?.repoConfig ?? "null");
    return repoConfigArtifactSchema.parse(parsed);
  }

  it("injects fixed-path config and snapshots outcomes and fired attributes", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    generator.outputs["brief"] = FIRING_BRIEF;
    const github = stubGitHub(HEAD_1);
    github.repoFiles.set(
      RepoConfigPaths.INSTRUCTIONS,
      buildRepoFile(INSTRUCTIONS_MD, "sha-i"),
    );
    github.repoFiles.set(
      RepoConfigPaths.SETTINGS,
      buildRepoFile(SETTINGS_YAML, "sha-s"),
    );
    github.repoFiles.set(
      RepoConfigPaths.POLICY,
      buildRepoFile(POLICY_YAML, "sha-p"),
    );
    const task = makeTask({ generator, github });

    await task(payload);

    expect(github.repoFileCalls.toSorted()).toEqual(
      [
        RepoConfigPaths.INSTRUCTIONS,
        RepoConfigPaths.SETTINGS,
        RepoConfigPaths.POLICY,
      ].toSorted(),
    );
    // The brief request carried the injected context, fenced data + contract,
    // and its schema ACCEPTED the custom token (the stub parses the canned
    // output through the request's own schema, so this line having passed IS
    // the enum-extension proof).
    const request = generator.requests.find(
      (candidate) => candidate.label === "brief",
    );
    expect(request?.user).toContain(
      '<repo_instructions path=".mergebrief/instructions.md" sha="sha-i">',
    );
    expect(request?.user).toContain("the biller");
    expect(request?.user).toContain(
      "- `touches-billing`: modifies invoicing code",
    );
    expect(request?.system).toContain(
      "## Repo instructions (semi-trusted, bounded)",
    );

    const artifact = await readStoredRepoConfig(pr, HEAD_1);
    expect(
      artifact.files.map((file) => [file.path, file.outcome, file.blobSha]),
    ).toEqual([
      [RepoConfigPaths.INSTRUCTIONS, "applied", "sha-i"],
      [RepoConfigPaths.SETTINGS, "applied", "sha-s"],
      [RepoConfigPaths.POLICY, "applied", "sha-p"],
    ]);
    expect(artifact.collisions).toEqual([]);
    expect(artifact.policy?.firedCustomAttributes).toEqual([
      {
        name: "touches-billing",
        criteria: "modifies invoicing code",
        implication: "needs finance review",
      },
    ]);
    expect(artifact.policy?.deEmphasize).toEqual([
      { attribute: "widens-error-handling" },
    ]);
  });

  it("records absent config and null policy without changing prompts", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const task = makeTask({ generator });

    await task(payload);

    const artifact = await readStoredRepoConfig(pr, HEAD_1);
    expect(
      artifact.files.every(
        (file) => file.outcome === "absent" && file.blobSha === null,
      ),
    ).toBe(true);
    expect(artifact.policy).toBeNull();
    const request = generator.requests.find(
      (candidate) => candidate.label === "brief",
    );
    expect(request?.user).not.toContain("repo_instructions");
    expect(request?.system).not.toContain("Repo instructions");
  });

  it("rejects invalid settings wholly while applying valid sibling files", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = stubGitHub(HEAD_1);
    github.repoFiles.set(
      RepoConfigPaths.SETTINGS,
      buildRepoFile("version: 2\n", "sha-bad"),
    );
    github.repoFiles.set(
      RepoConfigPaths.INSTRUCTIONS,
      buildRepoFile(INSTRUCTIONS_MD, "sha-i"),
    );
    const task = makeTask({ github });

    await task(payload);

    const artifact = await readStoredRepoConfig(pr, HEAD_1);
    const byPath = new Map(artifact.files.map((file) => [file.path, file]));
    expect(byPath.get(RepoConfigPaths.SETTINGS)?.outcome).toBe("invalid");
    expect(byPath.get(RepoConfigPaths.SETTINGS)?.blobSha).toBe("sha-bad");
    expect(byPath.get(RepoConfigPaths.INSTRUCTIONS)?.outcome).toBe("applied");
    // Job still succeeds, repo-config problems never fail a generation.
    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("generates despite per-file fetch failures and records their outcomes", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = stubGitHub(HEAD_1);
    github.repoFileErrors.set(RepoConfigPaths.POLICY, {
      code: "request-failed",
      status: 502,
      message: "failed to fetch repo file: GitHub API returned status 502",
    });
    github.repoFiles.set(
      RepoConfigPaths.SETTINGS,
      buildRepoFile(SETTINGS_YAML, "sha-s"),
    );
    const task = makeTask({ github });

    await task(payload);

    const artifact = await readStoredRepoConfig(pr, HEAD_1);
    const byPath = new Map(artifact.files.map((file) => [file.path, file]));
    expect(byPath.get(RepoConfigPaths.POLICY)?.outcome).toBe("fetch-failed");
    expect(byPath.get(RepoConfigPaths.SETTINGS)?.outcome).toBe("applied");
    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("records pre-decode oversize refusals as over-budget with fetch facts", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = stubGitHub(HEAD_1);
    github.repoFiles.set(RepoConfigPaths.INSTRUCTIONS, {
      kind: "too-large",
      blobSha: "sha-big",
      size: 20_000,
    });
    const task = makeTask({ github });

    await task(payload);

    const artifact = await readStoredRepoConfig(pr, HEAD_1);
    const instructions = artifact.files.find(
      (file) => file.path === RepoConfigPaths.INSTRUCTIONS,
    );
    expect(instructions?.outcome).toBe("over-budget");
    expect(instructions?.blobSha).toBe("sha-big");
    expect(instructions?.bytesUsed).toBe(20_000);
    expect(instructions?.bytesBudget).toBe(16 * 1024);
  });

  it("reuses stored snapshots without refetching config on skip drains", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    generator.outputs["brief"] = FIRING_BRIEF;
    const github = stubGitHub(HEAD_1);
    github.repoFiles.set(
      RepoConfigPaths.POLICY,
      buildRepoFile(POLICY_YAML, "sha-p"),
    );
    const task = makeTask({ generator, github });
    await task(payload);
    const fetchesAfterFirst = github.repoFileCalls.length;
    const before = await readStoredRepoConfig(pr, HEAD_1);

    await task(payload); // second drain: brief already stored → skip branch

    expect(github.repoFileCalls.length).toBe(fetchesAfterFirst);
    expect(await readStoredRepoConfig(pr, HEAD_1)).toEqual(before);
  });
});
