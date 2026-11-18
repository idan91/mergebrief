import type { ValueOf } from "types/utils";

/**
 * The web-only sentinel a required vocabulary field reads as when the server
 * sends a member this bundle predates. It never rides the wire.
 */
export const UnknownValues = {
  UNKNOWN: "unknown",
} as const;
export type UnknownValue = ValueOf<typeof UnknownValues>;
