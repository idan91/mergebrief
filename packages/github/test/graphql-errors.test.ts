// `mapGraphqlError`: the GraphQL taxonomy sibling of `mapRequestError`.
// GraphQL failures arrive as `GraphqlResponseError` (HTTP 200 + errors array),
// which the octokit umbrella does NOT export, so classification is structural.
// The same sanitization contract holds: no upstream message, token, or body
// text ever reaches a Result error.
import { RequestError } from "octokit";
import { describe, expect, it } from "vitest";
import { GitHubApiErrorCodes, mapGraphqlError } from "../src/errors";
import {
  LEAKED_TOKEN,
  UPSTREAM_TEXT,
  graphqlResponseError,
} from "./fixtures/graphql-error";

describe("mapGraphqlError", () => {
  it("maps NOT_FOUND to not-found without leaking upstream text", () => {
    const mapped = mapGraphqlError(
      graphqlResponseError([{ type: "NOT_FOUND", message: UPSTREAM_TEXT }]),
      "fetch pull request conversation",
    );
    expect(mapped.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
    const serialized = JSON.stringify(mapped);
    expect(serialized).not.toContain(LEAKED_TOKEN);
    expect(serialized).not.toContain("Could not resolve");
    // The request URL and auth header are planted on the thrown error too:
    // the full sanitization contract is token AND url AND header.
    expect(serialized).not.toContain("api.github.com");
    expect(serialized).not.toContain("authorization");
    expect(mapped.message).toBe(
      "failed to fetch pull request conversation: GitHub GraphQL query failed",
    );
  });

  it("lets RATE_LIMITED win over the other error types", () => {
    const mapped = mapGraphqlError(
      graphqlResponseError([
        { type: "NOT_FOUND", message: "x" },
        { type: "RATE_LIMITED", message: "y" },
      ]),
      "fetch pull request conversation",
    );
    expect(mapped.code).toBe(GitHubApiErrorCodes.RATE_LIMITED);
  });

  it("classifies an unrecognized GraphQL error type as request-failed", () => {
    const mapped = mapGraphqlError(
      graphqlResponseError([{ message: "internal weirdness" }]),
      "fetch pull request conversation",
    );
    expect(mapped.code).toBe(GitHubApiErrorCodes.REQUEST_FAILED);
    expect(JSON.stringify(mapped)).not.toContain("weirdness");
  });

  it("delegates an HTTP-level RequestError to the REST taxonomy", () => {
    const httpError = new RequestError("HTTP 401", 401, {
      request: {
        method: "POST",
        url: "https://api.github.com/graphql",
        headers: { authorization: `token ${LEAKED_TOKEN}` },
      },
      response: {
        status: 401,
        url: "https://api.github.com/graphql",
        headers: {},
        data: { message: "Bad credentials" },
      },
    });
    const mapped = mapGraphqlError(
      httpError,
      "fetch pull request conversation",
    );
    expect(mapped.code).toBe(GitHubApiErrorCodes.UNAUTHORIZED);
    expect(mapped.status).toBe(401);
    const serialized = JSON.stringify(mapped);
    expect(serialized).not.toContain(LEAKED_TOKEN);
    expect(serialized).not.toContain("api.github.com");
    expect(serialized).not.toContain("authorization");
    expect(serialized).not.toContain("Bad credentials");
  });

  it("classifies a GraphqlResponseError-shaped plain object", () => {
    // Detection is fully structural: a shape carrying the name + errors array
    // must classify even when it is not an `instanceof Error` in this realm.
    const shaped = {
      name: "GraphqlResponseError",
      message: UPSTREAM_TEXT,
      errors: [{ type: "FORBIDDEN", message: "nope" }],
    };
    const mapped = mapGraphqlError(shaped, "fetch pull request conversation");
    expect(mapped.code).toBe(GitHubApiErrorCodes.FORBIDDEN);
    expect(JSON.stringify(mapped)).not.toContain("Could not resolve");
  });

  it("maps a non-Error thrown value to request-failed", () => {
    const mapped = mapGraphqlError("boom", "fetch pull request conversation");
    expect(mapped.code).toBe(GitHubApiErrorCodes.REQUEST_FAILED);
    expect(mapped.message).not.toContain("boom");
  });
});
