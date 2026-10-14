// Shapes for the /api/auth/tokens endpoints.
import type { AccessLevel } from "types/access-levels";

import type { UnknownValue } from "@web/utils/open-enum/types";

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
