import type { ValueOf } from "types";

export interface SitePage {
  /** Path under `docs/`, the file GitHub renders. */
  source: string;
  /** Root-absolute site path before `base`, no extension. */
  link: `/${string}`;
  title: string;
}

/** The Self-hosting group's sub-groups, in the order an operator meets them. */
export const SelfHostPhases = {
  SET_UP: "set-up",
  CONFIGURE: "configure",
  SECURE: "secure",
  OPERATE: "operate",
} as const;

export type SelfHostPhase = ValueOf<typeof SelfHostPhases>;

export interface SelfHostSection {
  phase: SelfHostPhase;
  /** Starts folded; VitePress still opens it when it holds the current page. */
  collapsed: boolean;
  pages: readonly string[];
}

/** Group headings, resolved from the `docsSite.sidebar.*` catalog keys by the composition root. */
export interface SidebarGroupLabels {
  selfHosting: string;
  repoConfig: string;
  use: string;
  reference: string;
  releases: string;
}

export interface SidebarLabels extends SidebarGroupLabels {
  selfHostPhases: Readonly<Record<SelfHostPhase, string>>;
}
