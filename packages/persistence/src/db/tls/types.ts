import type { ValueOf } from "types/utils";

export const AllowedSslModes = {
  VERIFY_FULL: "verify-full",
  DISABLE: "disable",
} as const;

export type AllowedSslMode = ValueOf<typeof AllowedSslModes>;
