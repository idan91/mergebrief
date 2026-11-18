import { describe, expect, it } from "vitest";

import { appI18n } from "../../../../i18n/I18nProvider";
import { SCOPE_UNCHOSEN } from "../../hooks/useTokenSettings";
import type { ApiTokenView } from "../../types";
import { SCOPE_ORDER } from "./consts";
import { describeToken, parseExpiryChoice, parseScopeChoice } from "./utils";

const t = appI18n.t;
const LOCALE = "en-US";

const TOKEN: ApiTokenView = {
  id: "3",
  name: "ci-token",
  scope: "read",
  userLogin: "octocat",
  expiresAt: "2026-10-07T12:00:00.000Z",
  createdAt: "2026-07-09T12:00:00.000Z",
};

describe("describeToken", () => {
  it("leads an active token with its scope, then expiry and last use", () => {
    expect(describeToken(t, LOCALE, TOKEN)).toBe(
      "Read only · Expires Oct 7, 2026 · last used never",
    );
  });

  it("says never for a token with no expiry", () => {
    const { expiresAt: _expiresAt, ...noExpiry } = TOKEN;

    expect(describeToken(t, LOCALE, noExpiry)).toBe(
      "Read only · Expires never · last used never",
    );
  });

  it("dates a revoked token by its revocation", () => {
    const revoked = { ...TOKEN, revokedAt: "2026-07-10T12:00:00.000Z" };

    expect(describeToken(t, LOCALE, revoked)).toBe(
      "Read only · Revoked Jul 10, 2026",
    );
  });

  it("drops the scope label for a scope this bundle predates", () => {
    const unknownScope: ApiTokenView = { ...TOKEN, scope: "unknown" };

    expect(describeToken(t, LOCALE, unknownScope)).toBe(
      "Expires Oct 7, 2026 · last used never",
    );
  });
});

describe("parseExpiryChoice", () => {
  it("reads every expiry the form offers", () => {
    expect(["30", "90", "365", "none"].map(parseExpiryChoice)).toEqual([
      "30",
      "90",
      "365",
      "none",
    ]);
  });

  it("refuses a value the form never offers", () => {
    expect(parseExpiryChoice("7")).toBeUndefined();
    expect(parseExpiryChoice("")).toBeUndefined();
  });
});

describe("parseScopeChoice", () => {
  it("reads every scope the picker offers and the placeholder", () => {
    expect([...SCOPE_ORDER, SCOPE_UNCHOSEN].map(parseScopeChoice)).toEqual([
      ...SCOPE_ORDER,
      SCOPE_UNCHOSEN,
    ]);
  });

  it("refuses a value the picker never offers", () => {
    expect(parseScopeChoice("admin")).toBeUndefined();
    expect(parseScopeChoice("unknown")).toBeUndefined();
  });
});
