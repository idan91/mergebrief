import type { ValueOf } from "types/utils";

/**
 * Which credential a GitHub call ran on and whether its 403 means anything
 * the caller can act on; the posture decides the wire answer for a denial.
 */
export const DenialPostures = {
  /** A read on the viewer's credential: every refusal reads as absence. */
  COLLAPSE: "collapse",
  /** A write on the viewer's credential whose 403 is a capability signal. */
  HONEST: "honest",
  /** A read on the App installation's credential. */
  APP_READ: "app-read",
  /** A write on the App installation's credential. */
  APP_WRITE: "app-write",
} as const;
export type DenialPosture = ValueOf<typeof DenialPostures>;
