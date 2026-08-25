// The `gh` half of the CLI: a repo slug becomes a numeric repo id and a PR
// lifecycle. `gh` runs as the operator's own auth and only ever reads —
// nothing here stores a token.
import { execFileSync } from "node:child_process";
import { isRepoId, PrState, type PullRequestLifecycle } from "persistence";
import { z } from "zod";
import type { CliArgs } from "../args";
import type { RepoResolution, ResolveRepo } from "../ingest";
import { buildStaticLifecycle } from "./lifecycle";

const GhRepoSchema = z.object({ id: z.number().int().positive() });

const GhPrSchema = z.object({
  state: z.string(),
  merged: z.boolean().optional(),
  merged_at: z.string().nullable().optional(),
  closed_at: z.string().nullable().optional(),
  // The only source of a base SHA for a pre-index brief, which carries none.
  base: z.object({ sha: z.string().min(1) }).optional(),
});

type GhPr = z.infer<typeof GhPrSchema>;

function readGhJson(path: string): unknown {
  const stdout = execFileSync("gh", ["api", path], { encoding: "utf8" });
  return JSON.parse(stdout);
}

/** Open unless GitHub says otherwise; merged wins over closed. */
function buildResolvedLifecycle(pr: GhPr): PullRequestLifecycle {
  if (pr.merged !== true && pr.state !== "closed") {
    return { state: PrState.OPEN };
  }
  const closedAt = pr.merged_at ?? pr.closed_at ?? new Date().toISOString();
  const state = pr.merged === true ? PrState.MERGED : PrState.CLOSED;
  return { state, closedAt: new Date(closedAt), purgeAfter: null };
}

function resolveViaGh(repoSlug: string, prNumber: number): RepoResolution {
  const repo = GhRepoSchema.parse(readGhJson(`repos/${repoSlug}`));
  const pr = GhPrSchema.parse(
    readGhJson(`repos/${repoSlug}/pulls/${String(prNumber)}`),
  );
  const repoId = BigInt(repo.id);
  if (!isRepoId(repoId)) {
    throw new Error(`unusable repo id for ${repoSlug}`);
  }

  const resolved: {
    repoId: typeof repoId;
    lifecycle: PullRequestLifecycle;
    baseSha?: string;
  } = { repoId, lifecycle: buildResolvedLifecycle(pr) };
  if (pr.base !== undefined) {
    resolved.baseSha = pr.base.sha;
  }
  return resolved;
}

function resolveViaFlag(args: CliArgs, repoSlug: string): RepoResolution {
  if (args.repoId === undefined) {
    throw new Error(
      `no repo id for ${repoSlug} — pass --repo-id or --resolve-repos`,
    );
  }
  const repoId = BigInt(args.repoId);
  if (!isRepoId(repoId)) {
    throw new Error(`unusable --repo-id: ${args.repoId}`);
  }
  return { repoId, lifecycle: buildStaticLifecycle(args.state) };
}

export function createRepoResolver(args: CliArgs): ResolveRepo {
  return (repoSlug, prNumber) =>
    Promise.resolve(
      args.resolveRepos
        ? resolveViaGh(repoSlug, prNumber)
        : resolveViaFlag(args, repoSlug),
    );
}
