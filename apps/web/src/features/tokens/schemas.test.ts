// Parser tests against REALISTIC wire bodies: route tests that seed the query
// cache bypass the parser, so a shape drift would otherwise ship green.
import type {
  ApiTokenView as WireApiTokenView,
  ListTokensResponse,
  MintTokenResponse,
} from "contract";
import { describe, expect, it } from "vitest";
import type { Equals, Result } from "types/utils";
import type { z } from "zod/v4";

import { parseWithSchema } from "@web/utils/parse-with-schema";
import type { ReadsWireFields } from "@web/test/wire-fields";

import {
  type apiTokenSchema,
  mintedTokenSchema,
  tokensViewSchema,
} from "./schemas";
import type { ApiTokenView, MintedToken, TokensView } from "./types";

function parseTokensView(value: unknown): Result<TokensView, string> {
  return parseWithSchema(tokensViewSchema, value);
}

function parseMintedToken(value: unknown): Result<MintedToken, string> {
  return parseWithSchema(mintedTokenSchema, value);
}

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
  it("reads a scope this bundle predates as unknown, keeping the row", () => {
    const parsed = parseTokensView({
      tokens: [{ ...WIRE_TOKEN, scope: "admin" }],
    });
    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.value.tokens[0]?.scope).toBe("unknown");
  });

  it("refuses a token with no scope", () => {
    const { scope: _scope, ...unscoped } = WIRE_TOKEN;
    expect(parseTokensView({ tokens: [unscoped] }).ok).toBe(false);
  });

  it("parses the list body and reads its null timestamps as absent", () => {
    const parsed = parseTokensView({ tokens: [WIRE_TOKEN] });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    const {
      lastUsedAt: _lastUsed,
      revokedAt: _revoked,
      ...present
    } = WIRE_TOKEN;
    expect(parsed.value.tokens[0]).toStrictEqual(present);
  });

  it("reads a null owner login as absent", () => {
    const parsed = parseTokensView({
      tokens: [{ ...WIRE_TOKEN, userLogin: null }],
    });
    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.value.tokens[0]).not.toHaveProperty("userLogin");
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
    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.value.tokens[0]).not.toHaveProperty("expiresAt");
    expect(parsed.value.tokens[0]?.revokedAt).toBe("2026-07-09T14:00:00.000Z");
  });

  it("rejects a body missing tokens[] or with a malformed entry", () => {
    expect(parseTokensView({}).ok).toBe(false);
    expect(parseTokensView({ tokens: [{ id: 3 }] }).ok).toBe(false);
  });
});

describe("parseMintedToken", () => {
  it("rejects a response without token material", () => {
    expect(parseMintedToken({ apiToken: WIRE_TOKEN }).ok).toBe(false);
  });
});

const SCHEMA_PINS = {
  ApiTokenView: true satisfies Equals<
    z.output<typeof apiTokenSchema>,
    ApiTokenView
  >,
  TokensView: true satisfies Equals<
    z.output<typeof tokensViewSchema>,
    TokensView
  >,
  MintedToken: true satisfies Equals<
    z.output<typeof mintedTokenSchema>,
    MintedToken
  >,
} as const;

void SCHEMA_PINS;

const CONTRACT_PINS = {
  ApiTokenView: true satisfies ReadsWireFields<
    z.output<typeof apiTokenSchema>,
    WireApiTokenView
  >,
  TokensView: true satisfies ReadsWireFields<
    z.output<typeof tokensViewSchema>,
    ListTokensResponse
  >,
  MintedToken: true satisfies ReadsWireFields<
    z.output<typeof mintedTokenSchema>,
    MintTokenResponse
  >,
} as const;

void CONTRACT_PINS;
