import type { Octokit } from "octokit";
import { describe, expect, it, vi } from "vitest";
import {
  resolveMentionTargets,
  searchMentionableTeams,
  searchMentionableUsers,
} from "../src/operations/mentions";
import { MentionTargetKinds } from "../src/operations/mentions/types";
import { GitHubApiErrorCodes } from "../src/errors";
import { graphqlResponseError } from "./fixtures/graphql-error";
import {
  makeGqlMentionableTeam,
  makeGqlMentionableUser,
  makeMentionableTeamsResponse,
  makeMentionableUsersResponse,
  makePartialAliasError,
} from "./fixtures/mentions-graphql";

function mockGraphqlOctokit(graphql: ReturnType<typeof vi.fn>): Octokit {
  // The double assertion injects a structural mock where the full `Octokit`
  // type is expected.
  const stub = { graphql };
  return stub as unknown as Octokit;
}

describe("searchMentionableUsers", () => {
  it("maps users and sends the typed text only as a variable", async () => {
    const usersResponse = makeMentionableUsersResponse([
      makeGqlMentionableUser({ login: "cara", name: "Cara Example" }),
      makeGqlMentionableUser({ login: "carl", name: null }),
    ]);
    const graphql = vi.fn().mockResolvedValue(usersResponse);

    const result = await searchMentionableUsers(mockGraphqlOctokit(graphql), {
      owner: "acme",
      repo: "api",
      query: 'ca") { x }',
    });

    expect(result).toEqual({
      ok: true,
      value: [
        {
          login: "cara",
          name: "Cara Example",
          avatarUrl: "https://avatars.example/cara.png",
        },
        { login: "carl", avatarUrl: "https://avatars.example/carl.png" },
      ],
    });
    const [query, variables] = graphql.mock.calls[0] ?? [];
    expect(String(query)).not.toContain('ca")');
    expect(variables).toEqual({
      owner: "acme",
      repo: "api",
      search: 'ca") { x }',
    });
  });
});

describe("searchMentionableUsers failures", () => {
  it("reports not-found when GitHub hides the repository", async () => {
    const graphql = vi.fn().mockResolvedValue({ repository: null });

    const result = await searchMentionableUsers(mockGraphqlOctokit(graphql), {
      owner: "acme",
      repo: "api",
      query: "",
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: GitHubApiErrorCodes.NOT_FOUND },
    });
  });
});

describe("searchMentionableTeams", () => {
  it("maps the org's teams the viewer can see", async () => {
    const teamsResponse = makeMentionableTeamsResponse([
      makeGqlMentionableTeam("acme/backend", "Backend"),
      null,
    ]);
    const graphql = vi.fn().mockResolvedValue(teamsResponse);

    const result = await searchMentionableTeams(mockGraphqlOctokit(graphql), {
      org: "acme",
      query: "back",
    });

    expect(result).toEqual({
      ok: true,
      value: [{ combinedSlug: "acme/backend", name: "Backend" }],
    });
    const [, variables] = graphql.mock.calls[0] ?? [];
    expect(variables).toEqual({ org: "acme", search: "back" });
  });

  it("answers no teams when the owner is a person, not an org", async () => {
    const graphql = vi
      .fn()
      .mockRejectedValue(
        graphqlResponseError([{ type: "NOT_FOUND", message: "no org" }]),
      );

    const result = await searchMentionableTeams(mockGraphqlOctokit(graphql), {
      org: "dana",
      query: "",
    });

    expect(result).toEqual({ ok: true, value: [] });
  });

  it("reports a refusal when the App lacks the members permission", async () => {
    const graphql = vi
      .fn()
      .mockRejectedValue(
        graphqlResponseError([{ type: "FORBIDDEN", message: "no access" }]),
      );

    const result = await searchMentionableTeams(mockGraphqlOctokit(graphql), {
      org: "acme",
      query: "",
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: GitHubApiErrorCodes.FORBIDDEN },
    });
  });
});

const CARA = { kind: MentionTargetKinds.USER, login: "Cara" } as const;
const NOBODY = { kind: MentionTargetKinds.USER, login: "nobody" } as const;
const BACKEND = {
  kind: MentionTargetKinds.TEAM,
  org: "acme",
  slug: "backend",
} as const;

describe("resolveMentionTargets", () => {
  it("returns the targets GitHub shows, in GitHub's casing", async () => {
    const graphql = vi.fn().mockResolvedValue({
      u0: { login: "cara" },
      u1: null,
      t2: { team: { combinedSlug: "acme/backend" } },
    });

    const result = await resolveMentionTargets(mockGraphqlOctokit(graphql), {
      targets: [CARA, NOBODY, BACKEND],
    });

    expect(result).toEqual({
      ok: true,
      value: { users: ["cara"], teams: ["acme/backend"] },
    });
    const [query, variables] = graphql.mock.calls[0] ?? [];
    expect(String(query)).not.toContain("Cara");
    expect(variables).toEqual({
      u0: "Cara",
      u1: "nobody",
      o2: "acme",
      s2: "backend",
    });
  });

  it("reads the answered aliases when GitHub reports unknown ones", async () => {
    const graphql = vi.fn().mockRejectedValue(
      makePartialAliasError({ u0: { login: "cara" }, u1: null, t2: null }, [
        { type: "NOT_FOUND", path: ["u1"] },
        { type: "FORBIDDEN", path: ["t2"] },
      ]),
    );

    const result = await resolveMentionTargets(mockGraphqlOctokit(graphql), {
      targets: [CARA, NOBODY, BACKEND],
    });

    expect(result).toEqual({ ok: true, value: { users: ["cara"], teams: [] } });
  });

  it("makes no call for an empty list", async () => {
    const graphql = vi.fn();

    const result = await resolveMentionTargets(mockGraphqlOctokit(graphql), {
      targets: [],
    });

    expect(result).toEqual({ ok: true, value: { users: [], teams: [] } });
    expect(graphql).not.toHaveBeenCalled();
  });

  it("refuses more targets than one call takes", async () => {
    const octokit = mockGraphqlOctokit(vi.fn());
    const targets = Array.from({ length: 51 }, (_, index) => ({
      kind: MentionTargetKinds.USER,
      login: `user${index}`,
    }));

    await expect(resolveMentionTargets(octokit, { targets })).rejects.toThrow(
      "mention lookup takes at most 50 targets",
    );
  });
});
