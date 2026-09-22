// One GraphQL call reads up to a page of pull requests by alias: the live
// read's facts for url rows, one rate point per call instead of one REST
// call per row. A repository or pull request GitHub does not show comes back
// as null under its alias; an alias GitHub refused for another reason (SAML,
// a per-field outage) has no entry, and neither fails the page.
import type { Octokit } from "octokit";
import { z } from "zod";
import {
  mapGraphqlError,
  unexpectedResponseError,
  type GitHubApiError,
} from "../errors";
import { repoIdSchema } from "../ids";
import type { Result } from "../types";
import type { PullRequestRef } from "./pull-request/types";
import type { RepoId } from "persistence";

/** Aliases per call; GitHub's own page size for connections. */
export const LIVE_READ_PAGE_SIZE = 100;

const READ_CONTEXT = "read pull request facts";
const GRAPHQL_NOT_FOUND = "NOT_FOUND";

/** What one live read learns about a pull request. */
export interface PullRequestFacts {
  /**
   * The repository GitHub answered about, by immutable id and current name:
   * a caller that asked by a stored name checks the id before trusting the
   * facts, since a rename plus name reuse points the name elsewhere.
   */
  readonly repoId: RepoId;
  readonly repoFullName: string;
  /** GitHub PR state (`open` / `closed`); a merged PR is closed. */
  readonly state: string;
  readonly merged: boolean;
  readonly draft: boolean;
  readonly title: string;
  readonly closedAt: Date | null;
  readonly updatedAt: Date;
  readonly headSha: string;
  /** Null when the account is gone. */
  readonly authorLogin: string | null;
}

/**
 * Facts per ref key; null where GitHub shows no such pull request. A ref
 * with no entry got no answer this round: GitHub named its alias in an
 * error that is not NOT_FOUND, so nothing is known about it either way.
 */
export type LiveReadPage = ReadonlyMap<string, PullRequestFacts | null>;

/** The map key for a ref: `owner/repo#number`. */
export function getLiveReadKey(ref: PullRequestRef): string {
  return `${ref.owner}/${ref.repo}#${ref.prNumber}`;
}

const wireStateSchema = z.enum(["OPEN", "CLOSED", "MERGED"]);

const wirePullRequestSchema = z.object({
  state: wireStateSchema,
  isDraft: z.boolean(),
  title: z.string(),
  closedAt: z.string().nullable(),
  updatedAt: z.string(),
  headRefOid: z.string().min(1),
  author: z.object({ login: z.string() }).nullable(),
});

const wireRepositorySchema = z
  .object({
    databaseId: repoIdSchema,
    nameWithOwner: z.string().min(1),
    pullRequest: wirePullRequestSchema.nullable(),
  })
  .nullable();

const pageResponseSchema = z.record(z.string(), wireRepositorySchema);

const thrownPageSchema = z.object({
  data: z.record(z.string(), z.unknown()),
  errors: z.array(
    z.object({
      type: z.string().optional(),
      path: z.array(z.union([z.string(), z.number()])).optional(),
    }),
  ),
});

interface PartialPage {
  readonly data: Record<string, unknown>;
  /** Aliases an error other than NOT_FOUND names; they get no entry. */
  readonly unanswered: ReadonlySet<string>;
}

function buildQuery(count: number): string {
  const declarations: string[] = [];
  const selections: string[] = [];
  for (let index = 0; index < count; index += 1) {
    declarations.push(
      `$o${index}: String!, $r${index}: String!, $n${index}: Int!`,
    );
    selections.push(
      `p${index}: repository(owner: $o${index}, name: $r${index}) { databaseId nameWithOwner pullRequest(number: $n${index}) { state isDraft title closedAt updatedAt headRefOid author { login } } }`,
    );
  }
  return `query LiveRead(${declarations.join(", ")}) { ${selections.join(" ")} }`;
}

function buildVariables(
  refs: readonly PullRequestRef[],
): Record<string, string | number> {
  const variables: Record<string, string | number> = {};
  refs.forEach((ref, index) => {
    variables[`o${index}`] = ref.owner;
    variables[`r${index}`] = ref.repo;
    variables[`n${index}`] = ref.prNumber;
  });
  return variables;
}

function mapFacts(
  repository: NonNullable<z.infer<typeof wireRepositorySchema>>,
  wire: z.infer<typeof wirePullRequestSchema>,
): PullRequestFacts {
  return {
    repoId: repository.databaseId,
    repoFullName: repository.nameWithOwner,
    state: wire.state === "OPEN" ? "open" : "closed",
    merged: wire.state === "MERGED",
    draft: wire.isDraft,
    title: wire.title,
    closedAt: wire.closedAt === null ? null : new Date(wire.closedAt),
    updatedAt: new Date(wire.updatedAt),
    headSha: wire.headRefOid,
    authorLogin: wire.author?.login ?? null,
  };
}

/**
 * octokit throws whenever the errors array is not empty, but the throw still
 * carries the data for every alias GitHub did answer. A NOT_FOUND alias is
 * an answer (null); any other alias-level error withholds that alias only.
 * An error naming no alias, or a throw with no data, is a page failure.
 */
function readPartialData(error: unknown): PartialPage | undefined {
  const parsed = thrownPageSchema.safeParse(error);
  if (!parsed.success) return undefined;

  const unanswered = new Set<string>();
  for (const entry of parsed.data.errors) {
    if (entry.type === GRAPHQL_NOT_FOUND) continue;
    const alias = entry.path?.[0];
    if (typeof alias !== "string") return undefined;
    unanswered.add(alias);
  }
  return { data: parsed.data.data, unanswered };
}

/**
 * Read the facts for up to one page of pull requests in one call. A ref
 * gets facts, null when GitHub shows the viewer no such pull request, or no
 * entry when GitHub refused its alias alone, every alias included: only an
 * error naming no alias fails the page. More refs than a page is a
 * programmer error.
 */
export async function readPullRequestFacts(
  octokit: Octokit,
  refs: readonly PullRequestRef[],
): Promise<Result<LiveReadPage, GitHubApiError>> {
  if (refs.length > LIVE_READ_PAGE_SIZE) {
    throw new Error(`live read takes at most ${LIVE_READ_PAGE_SIZE} refs`);
  }
  const page = new Map<string, PullRequestFacts | null>();
  if (refs.length === 0) return { ok: true, value: page };

  let response: unknown;
  let unanswered: ReadonlySet<string> = new Set();
  try {
    response = await octokit.graphql(
      buildQuery(refs.length),
      buildVariables(refs),
    );
  } catch (error) {
    const partial = readPartialData(error);
    if (partial === undefined) {
      return { ok: false, error: mapGraphqlError(error, READ_CONTEXT) };
    }
    response = partial.data;
    unanswered = partial.unanswered;
  }

  const parsed = pageResponseSchema.safeParse(response);
  if (!parsed.success) {
    return { ok: false, error: unexpectedResponseError(READ_CONTEXT) };
  }
  refs.forEach((ref, index) => {
    if (unanswered.has(`p${index}`)) return;
    const repository = parsed.data[`p${index}`];
    const wire = repository?.pullRequest;
    page.set(
      getLiveReadKey(ref),
      repository === null ||
        repository === undefined ||
        wire === null ||
        wire === undefined
        ? null
        : mapFacts(repository, wire),
    );
  });
  return { ok: true, value: page };
}
