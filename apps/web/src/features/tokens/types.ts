// Shapes + boundary guards for the /api/auth/tokens endpoints.
import type { Result as SharedResult } from "types";

type Result<T> = SharedResult<T, string>;

/** One token as the settings list shows it — metadata only, never material. */
export interface ApiTokenView {
  readonly id: string;
  readonly name: string;
  readonly installationId: string;
  readonly userLogin: string | null;
  /** ISO timestamp, or null for a no-expiry token. */
  readonly expiresAt: string | null;
  readonly lastUsedAt: string | null;
  readonly revokedAt: string | null;
  readonly createdAt: string;
}

export interface TokensView {
  readonly tokens: ApiTokenView[];
}

/** The mint response — the ONE body that ever carries token material. */
export interface MintedToken {
  readonly token: string;
  readonly apiToken: ApiTokenView;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parseToken(value: unknown): Result<ApiTokenView> {
  if (!isRecord(value)) return { ok: false, error: "token must be an object" };
  if (typeof value["id"] !== "string") {
    return { ok: false, error: "id must be a string" };
  }
  if (typeof value["name"] !== "string") {
    return { ok: false, error: "name must be a string" };
  }
  if (typeof value["installationId"] !== "string") {
    return { ok: false, error: "installationId must be a string" };
  }
  if (!stringOrNull(value["userLogin"])) {
    return { ok: false, error: "userLogin must be a string or null" };
  }
  if (
    !stringOrNull(value["expiresAt"]) ||
    !stringOrNull(value["lastUsedAt"]) ||
    !stringOrNull(value["revokedAt"])
  ) {
    return { ok: false, error: "timestamps must be strings or null" };
  }
  if (typeof value["createdAt"] !== "string") {
    return { ok: false, error: "createdAt must be a string" };
  }
  return {
    ok: true,
    value: {
      id: value["id"],
      name: value["name"],
      installationId: value["installationId"],
      userLogin: value["userLogin"],
      expiresAt: value["expiresAt"],
      lastUsedAt: value["lastUsedAt"],
      revokedAt: value["revokedAt"],
      createdAt: value["createdAt"],
    },
  };
}

export function parseTokensView(value: unknown): Result<TokensView> {
  if (!isRecord(value) || !Array.isArray(value["tokens"])) {
    return { ok: false, error: "response must carry tokens[]" };
  }
  const tokens: ApiTokenView[] = [];
  for (const item of value["tokens"]) {
    const parsed = parseToken(item);
    if (!parsed.ok) return parsed;
    tokens.push(parsed.value);
  }
  return { ok: true, value: { tokens } };
}

export function parseMintedToken(value: unknown): Result<MintedToken> {
  if (!isRecord(value) || typeof value["token"] !== "string") {
    return { ok: false, error: "response must carry the token material" };
  }
  const apiToken = parseToken(value["apiToken"]);
  if (!apiToken.ok) return apiToken;
  return {
    ok: true,
    value: { token: value["token"], apiToken: apiToken.value },
  };
}
