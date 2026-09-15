// The PR's stack as GitHub has it NOW, read live for navigation. The brief
// carries its own stack snapshot from generation time; this view is what the
// header prefers when it has it, and the two differing is worth a line.
export interface PrStackMemberView {
  readonly number: number;
  readonly title: string;
}

/** A chain: every member has at most one open child. `index` is 1-based. */
export interface LinearPrStackView {
  readonly members: readonly PrStackMemberView[];
  readonly index: number;
}

/** The PR has two or more open children; the parent is optional. */
export interface ForkPrStackView {
  readonly parent?: PrStackMemberView;
  readonly children: readonly PrStackMemberView[];
}

export type PrStackView = LinearPrStackView | ForkPrStackView;

export interface PullStackView {
  /** Null when the PR sits in no open stack right now. */
  readonly stack: PrStackView | null;
}
