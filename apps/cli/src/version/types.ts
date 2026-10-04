import type { ValueOf } from "types/utils";

export interface Semver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/** The installed CLI and the server it talks to run different releases. */
export interface Skew {
  readonly server: string;
  readonly cli: string;
  readonly majorGap: boolean;
  /** Negative when the CLI is older than the server, positive when newer. */
  readonly direction: number;
}

/** How the binary was launched; it picks the update command's form. */
export const LaunchForms = {
  GLOBAL: "global",
  NPX: "npx",
} as const;
export type LaunchForm = ValueOf<typeof LaunchForms>;
