import { describe, expect, it } from "vitest";
import {
  createArtifactStore,
  createTenantRepository,
  createGenerationProjection,
  parseScopeContext,
} from "persistence";
import { GenerationStatuses } from "types/generations";
import { PrStates } from "types/pull-requests";
import type { z } from "zod/v4";
import type { Effort, GenerateRequest, Generator } from "generators";
import type { ContextProvider, ContextQuery } from "brief-core";
import { CredentialKinds, FakeFailures } from "github/testing";
import {
  BASE,
  ctx,
  harness,
  HEAD_1,
  HEAD_2,
  listCommentCalls,
  makeGitHub,
  makeRepoId,
  makeTarget,
  makeTask,
  pushHeadAfterFirstRead,
  seedViewerGrant,
  setUpHarness,
  stubGenerator,
  trigger,
  VIEWER_TOKEN,
} from "./helpers";

setUpHarness();

describe("generate task, url-box world", () => {
  it("drains url-box jobs with owner scope and viewer reads, without Entries", async () => {
    const ownerCtx = parseScopeContext({ ownerUserId: 555 });
    const grantId = await seedViewerGrant();
    const pr = await createTenantRepository(
      harness.handle,
      ownerCtx,
    ).pullRequests.upsert({
      repoId: makeRepoId(7n),
      prNumber: 7,
      repoSlug: "acme/widget",
      state: PrStates.OPEN,
    });
    // The pending projection row the enqueue door writes (the ingest side of the
    // handshake), the drain transitions it, never creates it.
    const pending = await createGenerationProjection(
      harness.handle,
      ownerCtx,
    ).upsertPending(makeTarget(pr, HEAD_1));
    expect(pending.ok).toBe(true);
    const payload = {
      owner_user_id: "555",
      grant_id: String(grantId),
      pull_request_id: String(pr.id),
      head_sha: HEAD_1,
    };
    const github = makeGitHub(HEAD_1);
    const task = makeTask({ github });

    await task(payload);

    // The credential path: every read rode the grant's viewer token, and the
    // installation binding was never asked for.
    const credentials = github.calls.map((call) => call.credential);
    expect(credentials).not.toHaveLength(0);
    expect(credentials).toEqual(
      credentials.map(() => ({
        kind: CredentialKinds.REVIEWER,
        token: VIEWER_TOKEN,
      })),
    );

    const brief = await createArtifactStore(
      harness.handle,
      ownerCtx,
    ).briefs.get(pr.id, BASE, HEAD_1);
    expect(brief).toBeDefined();
    expect(brief?.installationId).toBeNull();

    const row = await createGenerationProjection(harness.handle, ownerCtx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.SUCCEEDED);

    // The viewer's token must never write to GitHub: no comment ops at all.
    expect(listCommentCalls(github)).toEqual([]);
    expect(
      (
        await createTenantRepository(
          harness.handle,
          ownerCtx,
        ).pullRequests.getById(pr.id)
      )?.entryCommentId,
    ).toBeNull();

    const audits = await harness.raw(
      "select installation_id, source, operation, target_type from audit_log",
    );
    expect(audits).toContainEqual({
      installation_id: null,
      source: "url",
      operation: "generate",
      target_type: "brief",
    });
    // The run stamps GitHub's updated_at from the read it made.
    const stamped = await createTenantRepository(
      harness.handle,
      ownerCtx,
    ).pullRequests.getById(pr.id);
    expect(stamped?.githubUpdatedAt).toEqual(new Date("2026-09-20T10:00:00Z"));
  });

  it("queries the context providers main.ts injected with the PR's metadata", async () => {
    const ownerCtx = parseScopeContext({ ownerUserId: 555 });
    const grantId = await seedViewerGrant();
    const pr = await createTenantRepository(
      harness.handle,
      ownerCtx,
    ).pullRequests.upsert({
      repoId: makeRepoId(7n),
      prNumber: 7,
      repoSlug: "acme/widget",
      state: PrStates.OPEN,
    });
    const projection = createGenerationProjection(harness.handle, ownerCtx);
    expect((await projection.upsertPending(makeTarget(pr, HEAD_1))).ok).toBe(
      true,
    );
    const queries: ContextQuery[] = [];
    const provider: ContextProvider = {
      providerId: "url",
      fetch: async (query) => {
        queries.push(query);
        return { ok: true, value: [] };
      },
    };
    const task = makeTask({ contextProviders: [provider] });

    await task({
      owner_user_id: "555",
      grant_id: String(grantId),
      pull_request_id: String(pr.id),
      head_sha: HEAD_1,
    });

    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatchObject({
      title: "stub PR",
      headRef: "feature/stub",
      repo: { owner: "acme", repo: "widget" },
    });
  });

  it("requeues the observed head when a url-box PR moves before draining", async () => {
    // No installation means no webhook: if this run only stood down, the
    // paste would end with no brief and nothing scheduled.
    const ownerCtx = parseScopeContext({ ownerUserId: 555 });
    const grantId = await seedViewerGrant();
    const pr = await createTenantRepository(
      harness.handle,
      ownerCtx,
    ).pullRequests.upsert({
      repoId: makeRepoId(7n),
      prNumber: 7,
      repoSlug: "acme/widget",
      state: PrStates.OPEN,
    });
    const projection = createGenerationProjection(harness.handle, ownerCtx);
    expect((await projection.upsertPending(makeTarget(pr, HEAD_1))).ok).toBe(
      true,
    );
    const generator = stubGenerator();
    const task = makeTask({ generator, github: makeGitHub(HEAD_2) });

    await task({
      owner_user_id: "555",
      grant_id: String(grantId),
      pull_request_id: String(pr.id),
      head_sha: HEAD_1,
    });

    expect(generator.calls).toEqual([]);
    expect((await projection.get(makeTarget(pr, HEAD_1)))?.status).toBe(
      GenerationStatuses.SUPERSEDED,
    );
    expect((await projection.get(makeTarget(pr, HEAD_2)))?.status).toBe(
      GenerationStatuses.PENDING,
    );
    const jobs = await harness.raw(
      "select payload from graphile_worker.jobs where task_identifier = 'generate'",
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.["payload"]).toMatchObject({
      owner_user_id: "555",
      grant_id: String(grantId),
      head_sha: HEAD_2,
    });
  });

  it("re-queues the observed head when a url-box PR moves MID-generation", async () => {
    // The mid-stream poller aborts the SDK call, which surfaces as an abort
    // rather than a head mismatch, the follow-up must ride that path too.
    const ownerCtx = parseScopeContext({ ownerUserId: 555 });
    const grantId = await seedViewerGrant();
    const pr = await createTenantRepository(
      harness.handle,
      ownerCtx,
    ).pullRequests.upsert({
      repoId: makeRepoId(7n),
      prNumber: 7,
      repoSlug: "acme/widget",
      state: PrStates.OPEN,
    });
    const projection = createGenerationProjection(harness.handle, ownerCtx);
    expect((await projection.upsertPending(makeTarget(pr, HEAD_1))).ok).toBe(
      true,
    );
    const github = makeGitHub(HEAD_1);
    // The pre-flight read sees the job's head; every poll after it sees the
    // push that supersedes this run.
    pushHeadAfterFirstRead(github, HEAD_2);
    const hangingGenerator: Generator = {
      async generate<S extends z.ZodType>(
        req: GenerateRequest<S>,
      ): Promise<z.infer<S>> {
        return new Promise<never>((_, reject) => {
          req.signal?.addEventListener("abort", () => {
            reject(
              Object.assign(new Error("Request was aborted."), {
                name: "APIUserAbortError",
              }),
            );
          });
        });
      },
      origin: (effort: Effort) => ({
        provider: "stub",
        model: "stub-model",
        effort,
      }),
    };
    const task = makeTask({
      generator: hangingGenerator,
      github,
      headPollIntervalMs: 5,
    });

    await task({
      owner_user_id: "555",
      grant_id: String(grantId),
      pull_request_id: String(pr.id),
      head_sha: HEAD_1,
    });

    expect((await projection.get(makeTarget(pr, HEAD_1)))?.status).toBe(
      GenerationStatuses.SUPERSEDED,
    );
    expect((await projection.get(makeTarget(pr, HEAD_2)))?.status).toBe(
      GenerationStatuses.PENDING,
    );
    const jobs = await harness.raw(
      "select payload from graphile_worker.jobs where task_identifier = 'generate'",
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.["payload"]).toMatchObject({
      owner_user_id: "555",
      grant_id: String(grantId),
      head_sha: HEAD_2,
    });
  });

  it("queues the successor from the read it already made, not a fresh one", async () => {
    // Every GitHub read after the abort fails. The follow-up must still queue
    // HEAD_2 off the read the watch already made, re-reading here would
    // finalize `superseded` with nothing scheduled, and no webhook exists to
    // bring the successor back.
    const ownerCtx = parseScopeContext({ ownerUserId: 555 });
    const grantId = await seedViewerGrant();
    const pr = await createTenantRepository(
      harness.handle,
      ownerCtx,
    ).pullRequests.upsert({
      repoId: makeRepoId(7n),
      prNumber: 7,
      repoSlug: "acme/widget",
      state: PrStates.OPEN,
    });
    const projection = createGenerationProjection(harness.handle, ownerCtx);
    expect((await projection.upsertPending(makeTarget(pr, HEAD_1))).ok).toBe(
      true,
    );
    const github = makeGitHub(HEAD_1);
    pushHeadAfterFirstRead(github, HEAD_2);
    const hangingGenerator: Generator = {
      async generate<S extends z.ZodType>(
        req: GenerateRequest<S>,
      ): Promise<z.infer<S>> {
        return new Promise<never>((_, reject) => {
          req.signal?.addEventListener("abort", () => {
            // From the abort on, GitHub is unreachable.
            github.failOn("fetchPullRequest", FakeFailures.SERVER_ERROR);
            reject(
              Object.assign(new Error("Request was aborted."), {
                name: "APIUserAbortError",
              }),
            );
          });
        });
      },
      origin: (effort: Effort) => ({
        provider: "stub",
        model: "stub-model",
        effort,
      }),
    };
    const task = makeTask({
      generator: hangingGenerator,
      github,
      headPollIntervalMs: 5,
    });

    await task({
      owner_user_id: "555",
      grant_id: String(grantId),
      pull_request_id: String(pr.id),
      head_sha: HEAD_1,
    });

    expect((await projection.get(makeTarget(pr, HEAD_2)))?.status).toBe(
      GenerationStatuses.PENDING,
    );
  });

  it("a url-box job cannot address an installation tenant's PR", async () => {
    // Installation world owns the row; a url-box payload naming its id must
    // drop (no artifacts, no projection transition).
    const { pr } = await trigger(HEAD_1);
    const payload = {
      owner_user_id: "555",
      grant_id: "31",
      pull_request_id: String(pr.id),
      head_sha: HEAD_1,
    };
    const generator = stubGenerator();
    const task = makeTask({ generator });

    await task(payload);

    expect(generator.calls).toEqual([]);
    const brief = await createArtifactStore(harness.handle, ctx).briefs.get(
      pr.id,
      BASE,
      HEAD_1,
    );
    expect(brief).toBeUndefined();
  });
});
