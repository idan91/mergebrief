export interface SplitPath {
  /** Everything up to and including the last slash; empty for a bare name. */
  directory: string;
  fileName: string;
}
