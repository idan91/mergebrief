import { AccessLevels } from "types/access-levels";

/** Catalog key per rung, the same label in the picker and in the list. */
export const SCOPE_LABEL_KEY = {
  [AccessLevels.READ]: "tokens.scopeRead",
  [AccessLevels.PRIVATE_WRITE]: "tokens.scopePrivateWrite",
  [AccessLevels.EXTERNAL_WRITE]: "tokens.scopeExternalWrite",
} as const;

/** Narrowest first: the list reads as a ladder, not an unordered set. */
export const SCOPE_ORDER = [
  AccessLevels.READ,
  AccessLevels.PRIVATE_WRITE,
  AccessLevels.EXTERNAL_WRITE,
] as const;
