import type { TFunction } from "i18next";

import { UnknownValues } from "@web/utils/open-enum/types";
import { formatDate } from "../../../../i18n/locale";
import {
  ExpiryChoices,
  type ApiTokenView,
  type ExpiryChoice,
} from "../../types";
import { SCOPE_UNCHOSEN, type ScopeChoice } from "../../hooks/useTokenSettings";
import { SCOPE_LABEL_KEY, SCOPE_ORDER } from "./consts";

function formatWhen(
  iso: string | undefined,
  locale: string,
  never: string,
): string {
  if (iso === undefined) {
    return never;
  }
  return formatDate(iso, locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** The expiry a select value names; undefined for one the form never offers. */
export function parseExpiryChoice(value: string): ExpiryChoice | undefined {
  return Object.values(ExpiryChoices).find((choice) => choice === value);
}

/** The scope a select value names, or the unchosen placeholder; undefined for one the form never offers. */
export function parseScopeChoice(value: string): ScopeChoice | undefined {
  if (value === SCOPE_UNCHOSEN) {
    return SCOPE_UNCHOSEN;
  }
  return SCOPE_ORDER.find((scope) => scope === value);
}

/** A token row's second line: its scope label, then its dates. */
export function describeToken(
  t: TFunction,
  locale: string,
  token: ApiTokenView,
): string {
  const never = t("tokens.never");
  const scopeLabel =
    token.scope === UnknownValues.UNKNOWN
      ? undefined
      : t(SCOPE_LABEL_KEY[token.scope]);
  const dates =
    token.revokedAt === undefined
      ? t("tokens.rowActive", {
          expires: formatWhen(token.expiresAt, locale, never),
          lastUsed: formatWhen(token.lastUsedAt, locale, never),
        })
      : t("tokens.rowRevoked", {
          when: formatWhen(token.revokedAt, locale, never),
        });
  return scopeLabel === undefined ? dates : `${scopeLabel} · ${dates}`;
}
