import { describe, expect, it } from "vitest";
import { resolveOperatorTokenOwner } from "../../src/client/operator-owner";
import type { OwnedOperatorToken } from "../../src/client/types";
import {
  makeLogger,
  makeOctokitFactory,
  requireOperatorToken,
  requireReviewerId,
  stubGitHubFetch,
  type RouteHandler,
  type StubResponse,
} from "./helpers";

const OPERATOR = "ghp_operator_owner";
const OWNER_ID = 583231;
const OWNER = requireReviewerId(BigInt(OWNER_ID));
const OTHER = requireReviewerId(9919n);
const OWNER_BODY = { id: OWNER_ID, login: "octocat" };
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;

interface ScheduledRetry {
  readonly delayMs: number;
  run(): Promise<void>;
}

interface Resolution {
  readonly owned: OwnedOperatorToken;
  readonly log: ReturnType<typeof makeLogger>;
  readonly retries: ScheduledRetry[];
}

async function resolveWith(route: RouteHandler): Promise<Resolution> {
  const log = makeLogger();
  const retries: ScheduledRetry[] = [];
  const owned = await resolveOperatorTokenOwner(
    requireOperatorToken(OPERATOR),
    {
      log,
      octokitFactory: makeOctokitFactory(stubGitHubFetch(route)),
      scheduleRetry: (run, delayMs) => {
        retries.push({ run, delayMs });
      },
    },
  );
  return { owned, log, retries };
}

function answerInTurn(answers: readonly StubResponse[]): RouteHandler {
  let call = 0;
  return () => {
    const answer = answers[Math.min(call, answers.length - 1)];
    call += 1;
    if (answer === undefined) {
      throw new Error("no answer arranged");
    }
    return answer;
  };
}

function readLoggedText(log: ReturnType<typeof makeLogger>): string {
  const calls = [log.error, log.warn, log.info, log.debug].flatMap(
    (method) => method.mock.calls,
  );
  return JSON.stringify(calls, (_key, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value,
  );
}

describe("resolveOperatorTokenOwner", () => {
  it("serves only the account GitHub names as the token's owner", async () => {
    const { owned, log, retries } = await resolveWith(() => ({
      status: 200,
      body: OWNER_BODY,
    }));

    expect(owned.isOwnedBy(OWNER)).toBe(true);
    expect(owned.isOwnedBy(OTHER)).toBe(false);
    expect(owned.isLookupPending()).toBe(false);
    expect(owned.token).toBe(OPERATOR);
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(retries).toEqual([]);
  });

  it.each([
    { status: 401, code: "unauthorized" },
    { status: 403, code: "forbidden" },
    { status: 404, code: "not-found" },
  ])(
    "serves nobody after GitHub refuses the token: $status",
    async (refusal) => {
      const { owned, log, retries } = await resolveWith(() => ({
        status: refusal.status,
        body: { message: "refused" },
      }));

      expect(owned.isOwnedBy(OWNER)).toBe(false);
      expect(owned.isLookupPending()).toBe(false);
      expect(retries).toEqual([]);
      expect(log.error).toHaveBeenCalledTimes(1);
      expect(log.error.mock.calls[0]?.[1]).toEqual({
        evt: "url-fallback-token.owner.fail",
        status: refusal.status,
        code: refusal.code,
      });
      expect(readLoggedText(log)).not.toContain(OPERATOR);
    },
  );

  it.each<{ name: string; answer: StubResponse }>([
    {
      name: "a rate-limited 403",
      answer: {
        status: 403,
        body: { message: "API rate limit exceeded" },
        headers: { "x-ratelimit-remaining": "0" },
      },
    },
    { name: "an ill-shaped 200", answer: { status: 200, body: { id: "x" } } },
  ])("serves nobody and retries after $name", async ({ answer }) => {
    const { owned, log, retries } = await resolveWith(() => answer);

    expect(owned.isOwnedBy(OWNER)).toBe(false);
    expect(owned.isLookupPending()).toBe(true);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.error).not.toHaveBeenCalled();
    expect(retries.map((retry) => retry.delayMs)).toEqual([30 * SECOND_MS]);
    expect(readLoggedText(log)).not.toContain(OPERATOR);
  });

  it("serves nobody and retries when the lookup never completes", async () => {
    const { owned, retries } = await resolveWith(() => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });

    expect(owned.isOwnedBy(OWNER)).toBe(false);
    expect(owned.isLookupPending()).toBe(true);
    expect(retries).toHaveLength(1);
  });

  it("serves the owner once a retry resolves the lookup", async () => {
    const { owned, log, retries } = await resolveWith(
      answerInTurn([
        { status: 503, body: { message: "unavailable" } },
        { status: 200, body: OWNER_BODY },
      ]),
    );

    await retries[0]?.run();

    expect(owned.isOwnedBy(OWNER)).toBe(true);
    expect(owned.isLookupPending()).toBe(false);
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(retries).toHaveLength(1);
  });

  it("doubles the retry delay from 30 s and caps it at 15 min", async () => {
    const { owned, log, retries } = await resolveWith(() => ({
      status: 500,
      body: { message: "down" },
    }));

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await retries.at(-1)?.run();
    }

    expect(retries.map((retry) => retry.delayMs)).toEqual([
      30 * SECOND_MS,
      1 * MINUTE_MS,
      2 * MINUTE_MS,
      4 * MINUTE_MS,
      8 * MINUTE_MS,
      15 * MINUTE_MS,
      15 * MINUTE_MS,
    ]);
    expect(log.warn).toHaveBeenCalledTimes(7);
    expect(owned.isLookupPending()).toBe(true);
  });

  it("stops retrying once a retry is refused", async () => {
    const { owned, log, retries } = await resolveWith(
      answerInTurn([
        { status: 500, body: { message: "down" } },
        { status: 401, body: { message: "Bad credentials" } },
      ]),
    );

    await retries[0]?.run();

    expect(owned.isLookupPending()).toBe(false);
    expect(owned.isOwnedBy(OWNER)).toBe(false);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(retries).toHaveLength(1);
  });
});
