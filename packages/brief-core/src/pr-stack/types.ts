export interface PrStackMember {
  number: number;
  title: string;
}

export interface LinearPrStack {
  members: PrStackMember[];
  index: number;
}

export interface ForkPrStack {
  parent?: PrStackMember;
  children: PrStackMember[];
}

export type PrStack = LinearPrStack | ForkPrStack;

/** A stack as parsed back from storage: the fork's parent may be an explicit undefined. */
export type StoredPrStack =
  | LinearPrStack
  | { parent?: PrStackMember | undefined; children: PrStackMember[] };

export interface RepoIdentity {
  owner: string;
  repo: string;
}

export interface OpenPullRequest {
  number: number;
  title: string;
  headRef: string;
  baseRef: string;
  headRepo: RepoIdentity;
  baseRepo: RepoIdentity;
}

export interface PrStackSelf {
  number: number;
  title: string;
  headRef: string;
  baseRef?: string;
  headRepo?: RepoIdentity;
  baseRepo?: RepoIdentity;
}
