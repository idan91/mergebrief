// Structural `GraphqlResponseError` fixture (BRIEF-25): the class is not
// exported from the octokit umbrella, so tests shape it the way
// `@octokit/graphql` builds it — an Error named "GraphqlResponseError"
// carrying the GraphQL `errors` array and the raw response.

// A leaked auth header/token must never surface in a sanitized error — tests
// plant this in thrown errors and assert it never escapes.
export const LEAKED_TOKEN = "ghs_PLANTED_INSTALLATION_TOKEN";
export const UPSTREAM_TEXT = "Could not resolve to a Repository with the name 'o/r'.";

export function graphqlResponseError(
  errors: ReadonlyArray<{ type?: string; message: string }>,
): Error {
  const error = new Error(
    `Request failed due to following response errors:\n${UPSTREAM_TEXT}`,
  );
  error.name = "GraphqlResponseError";
  return Object.assign(error, {
    errors,
    request: {
      method: "POST",
      url: "https://api.github.com/graphql",
      headers: { authorization: `token ${LEAKED_TOKEN}` },
    },
    response: { data: null, errors, token: LEAKED_TOKEN },
    data: null,
  });
}
