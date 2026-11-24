export interface SitePage {
  /** Path under `docs/`, the file GitHub renders. */
  source: string;
  /** Root-absolute site path before `base`, no extension. */
  link: `/${string}`;
  title: string;
}

/** Group headings, resolved from the `docsSite.sidebar.*` catalog keys by the composition root. */
export interface SidebarLabels {
  selfHosting: string;
  repoConfig: string;
  use: string;
  reference: string;
  releases: string;
}
