// Collaborators primitive: everyone who can collaborate on the repo, direct
// collaborators AND org/team-granted members (`affiliation: ALL` is critical).
// Drives the wire→domain mapping, the capped cursor loop, and the sanitized
// failure paths.
import type { Octokit } from "octokit";
import { describe, expect, it, vi } from "vitest";
import { listRepoCollaborators } from "../src/operations/collaborators";
import { GitHubApiErrorCodes } from "../src/errors";
import {
  collaboratorsResponse,
  gqlCollaborator,
} from "./fixtures/collaborators-graphql";
import {
  LEAKED_TOKEN,
  UPSTREAM_TEXT,
  graphqlResponseError,
} from "./fixtures/graphql-error";

function mockGraphqlOctokit(graphql: ReturnType<typeof vi.fn>): Octokit {
  // The double assertion injects a structural mock where the full `Octokit`
  // type is expected.
  const stub = { graphql };
  return stub as unknown as Octokit;
}

const INPUT = { owner: "o", repo: "r" } as const;

describe("listRepoCollaborators mapping", () => {
  it("maps collaborator fields and sends affiliation ALL as a variable", async () => {
    const graphql = vi.fn().mockResolvedValue(
      collaboratorsResponse({
        nodes: [
          gqlCollaborator({ login: "alice", name: "Alice Example" }),
          gqlCollaborator({ login: "bob", name: null }),
        ],
      }),
    );
    const result = await listRepoCollaborators(
      mockGraphqlOctokit(graphql),
      INPUT,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.hasMore).toBe(false);
    expect(result.value.collaborators).toEqual([
      {
        login: "alice",
        name: "Alice Example",
        avatarUrl: "https://avatars.example/alice.png",
      },
      { login: "bob", avatarUrl: "https://avatars.example/bob.png" },
    ]);
    // affiliation ALL includes org/team-granted access, the bulk of the pool.
    const [query, variables] = graphql.mock.calls[0] ?? [];
    expect(String(query)).toContain("affiliation: ALL");
    expect(String(query)).toContain("$owner");
    expect(variables).toMatchObject({ owner: "o", repo: "r" });
  });

  it("skips null node elements and treats a null nodes list as empty", async () => {
    const graphql = vi.fn().mockResolvedValue(
      collaboratorsResponse({
        nodes: [null, gqlCollaborator({ login: "carol" }), null],
      }),
    );
    const result = await listRepoCollaborators(
      mockGraphqlOctokit(graphql),
      INPUT,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(
      result.value.collaborators.map((collaborator) => collaborator.login),
    ).toEqual(["carol"]);

    const nullList = vi
      .fn()
      .mockResolvedValue(collaboratorsResponse({ nodes: null }));
    const emptyResult = await listRepoCollaborators(
      mockGraphqlOctokit(nullList),
      INPUT,
    );
    expect(emptyResult.ok).toBe(true);
    if (!emptyResult.ok) {
      throw new Error("unreachable");
    }
    expect(emptyResult.value.collaborators).toEqual([]);
  });
});

describe("listRepoCollaborators pagination", () => {
  it("follows the cursor across pages and reports hasMore false at the end", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(
        collaboratorsResponse({
          nodes: [gqlCollaborator({ login: "alice" })],
          hasNextPage: true,
          endCursor: "cursor-1",
        }),
      )
      .mockResolvedValueOnce(
        collaboratorsResponse({ nodes: [gqlCollaborator({ login: "bob" })] }),
      );
    const result = await listRepoCollaborators(
      mockGraphqlOctokit(graphql),
      INPUT,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(
      result.value.collaborators.map((collaborator) => collaborator.login),
    ).toEqual(["alice", "bob"]);
    expect(result.value.hasMore).toBe(false);
    expect(graphql).toHaveBeenCalledTimes(2);
    const [, secondVariables] = graphql.mock.calls[1] ?? [];
    expect(secondVariables).toMatchObject({ cursor: "cursor-1" });
  });

  it("stops at the page cap and flags hasMore instead of looping", async () => {
    const graphql = vi
      .fn()
      .mockImplementation((_query: string, variables: { cursor?: string }) =>
        Promise.resolve(
          collaboratorsResponse({
            nodes: [
              gqlCollaborator({ login: `user-${variables.cursor ?? "first"}` }),
            ],
            hasNextPage: true,
            endCursor: `cursor-${variables.cursor ?? "0"}`,
          }),
        ),
      );
    const result = await listRepoCollaborators(
      mockGraphqlOctokit(graphql),
      INPUT,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    // Cap is 3 pages × 100; past that the pool is noise, not autocomplete.
    expect(graphql).toHaveBeenCalledTimes(3);
    expect(result.value.collaborators).toHaveLength(3);
    expect(result.value.hasMore).toBe(true);
  });
});

describe("listRepoCollaborators failures", () => {
  it("returns sanitized NOT_FOUND for a null repository field", async () => {
    const graphql = vi.fn().mockResolvedValue({ repository: null });
    const result = await listRepoCollaborators(
      mockGraphqlOctokit(graphql),
      INPUT,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
    expect(result.error.message).not.toContain("o/r");
  });

  it("returns sanitized NOT_FOUND for a null collaborators connection", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValue({ repository: { collaborators: null } });
    const result = await listRepoCollaborators(
      mockGraphqlOctokit(graphql),
      INPUT,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
  });

  it("maps a FORBIDDEN GraphQL error without leaking token or upstream text", async () => {
    const graphql = vi
      .fn()
      .mockRejectedValue(
        graphqlResponseError([{ type: "FORBIDDEN", message: UPSTREAM_TEXT }]),
      );
    const result = await listRepoCollaborators(
      mockGraphqlOctokit(graphql),
      INPUT,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.FORBIDDEN);
    expect(result.error.message).not.toContain(LEAKED_TOKEN);
    expect(result.error.message).not.toContain(UPSTREAM_TEXT);
  });

  it("returns a sanitized failure for an ill-shaped 2xx body on any page", async () => {
    const malformed = vi
      .fn()
      .mockResolvedValue({ repository: { collaborators: { nope: true } } });
    const result = await listRepoCollaborators(
      mockGraphqlOctokit(malformed),
      INPUT,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.REQUEST_FAILED);

    const midPage = vi
      .fn()
      .mockResolvedValueOnce(
        collaboratorsResponse({ hasNextPage: true, endCursor: "cursor-1" }),
      )
      .mockResolvedValueOnce({ repository: null });
    const midResult = await listRepoCollaborators(
      mockGraphqlOctokit(midPage),
      INPUT,
    );
    expect(midResult.ok).toBe(false);
    if (midResult.ok) {
      throw new Error("unreachable");
    }
    expect(midResult.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
  });
});
