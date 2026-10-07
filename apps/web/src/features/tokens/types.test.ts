// Parser tests against REALISTIC wire bodies: route tests that seed the query
// cache bypass the parser, so a shape drift would otherwise ship green.
import { describe, expect, it } from "vitest";

import { parseMintedToken, parseTokensView } from "./types";

const WIRE_TOKEN = {
  id: "3",
  name: "ci-token",
  scope: "private-write",
  userLogin: "octocat",
  expiresAt: "2026-10-07T00:00:00.000Z",
  lastUsedAt: null,
  revokedAt: null,
  createdAt: "2026-07-09T12:00:00.000Z",
};

describe("parseTokensView", () => {
  it("rejects a token whose scope is not one of the three rungs", () => {
    const parsed = parseTokensView({
      tokens: [{ ...WIRE_TOKEN, scope: "admin" }],
    });
    expect(parsed.ok).toBe(false);
  });

  it("parses the /api/auth/tokens list body", () => {
    const parsed = parseTokensView({ tokens: [WIRE_TOKEN] });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.value.tokens[0]).toEqual(WIRE_TOKEN);
  });

  it("accepts no-expiry and used/revoked timestamps", () => {
    const parsed = parseTokensView({
      tokens: [
        {
          ...WIRE_TOKEN,
          expiresAt: null,
          lastUsedAt: "2026-07-09T13:00:00.000Z",
          revokedAt: "2026-07-09T14:00:00.000Z",
        },
      ],
    });
    expect(parsed.ok).toBe(true);
  });

  it("rejects a body missing tokens[] or with a malformed entry", () => {
    expect(parseTokensView({}).ok).toBe(false);
    expect(parseTokensView({ tokens: [{ id: 3 }] }).ok).toBe(false);
  });
});

describe("parseMintedToken", () => {
  it("parses the mint response with its token material and metadata", () => {
    const parsed = parseMintedToken({
      token: "mergebrief_abc123",
      apiToken: WIRE_TOKEN,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.value.token).toBe("mergebrief_abc123");
    expect(parsed.value.apiToken.name).toBe("ci-token");
  });

  it("rejects a response without token material", () => {
    expect(parseMintedToken({ apiToken: WIRE_TOKEN }).ok).toBe(false);
  });
});
