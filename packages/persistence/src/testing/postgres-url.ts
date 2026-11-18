const TEST_POSTGRES_URL_VARIABLE = "MERGEBRIEF_TEST_POSTGRES_URL";

export type TestPostgresUrl = string | undefined;

/**
 * The real-Postgres URL for the suites PGlite cannot exercise. Unset locally
 * means skip; unset under CI throws, so a skip there cannot pass unseen.
 */
export function readTestPostgresUrl(
  env: Readonly<Record<string, string | undefined>>,
): TestPostgresUrl {
  const url = env[TEST_POSTGRES_URL_VARIABLE];
  if (url !== undefined && url !== "") {
    return url;
  }

  const ci = env["CI"];
  if (ci !== undefined && ci !== "") {
    throw new Error(
      `${TEST_POSTGRES_URL_VARIABLE} is unset under CI; the real-Postgres suites would skip`,
    );
  }
  return undefined;
}
