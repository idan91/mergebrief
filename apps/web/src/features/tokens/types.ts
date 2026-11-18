// Shapes for the /api/auth/tokens endpoints.
import type { AccessLevel } from "types/access-levels";
import type { ValueOf } from "types/utils";

import type { UnknownValue } from "@web/utils/open-enum/types";

/** The expiry choices the create form offers; `none` = no expiry. */
export const ExpiryChoices = {
  THIRTY_DAYS: "30",
  NINETY_DAYS: "90",
  ONE_YEAR: "365",
  NONE: "none",
} as const;
export type ExpiryChoice = ValueOf<typeof ExpiryChoices>;

/** The create-form fields a blocked reason can be about. */
export const MintFields = {
  NAME: "name",
  SCOPE: "scope",
} as const;
export type MintField = ValueOf<typeof MintFields>;

/** Why the create form cannot submit, and the field the reason is about. */
export interface MintBlock {
  readonly field: MintField;
  readonly reason: string;
}

/** One token as the settings list shows it; metadata only, never material. */
export interface ApiTokenView {
  readonly id: string;
  readonly name: string;
  /** `unknown` for a scope this bundle predates. */
  readonly scope: AccessLevel | UnknownValue;
  readonly userLogin?: string;
  /** ISO timestamp; absent on a no-expiry token. */
  readonly expiresAt?: string;
  readonly lastUsedAt?: string;
  readonly revokedAt?: string;
  readonly createdAt: string;
}

export interface TokensView {
  readonly tokens: ApiTokenView[];
}

/** The mint response; the ONE body that ever carries token material. */
export interface MintedToken {
  readonly token: string;
  readonly apiToken: ApiTokenView;
}
