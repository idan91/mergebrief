import type { ValueOf } from "types/utils";

/** Whether GitHub still holds an installation of this App. */
export const InstallationPresences = {
  PRESENT: "present",
  GONE: "gone",
} as const;
export type InstallationPresence = ValueOf<typeof InstallationPresences>;
