/** One repository the viewer may address, its id stringified. */
export interface RepoView {
  readonly repoId: string;
  readonly fullName: string;
}

/** What `list-repos` answers: the viewer's allowed repositories, `fullName` ascending. */
export interface ListReposResponse {
  readonly repos: readonly RepoView[];
}
