/** The base URL the CLI is configured with; the api harness maps it to the API. */
export const BASE_URL = "https://mb.example";

export const BASE_SHA = "a".repeat(40);
export const HEAD_SHA = "b".repeat(40);
export const SPAN_FLAGS = ["--base", BASE_SHA, "--head", HEAD_SHA];

/** The body shape version every fixture artifact row is stamped with. */
export const FIXTURE_BODY_VERSION = 1;
