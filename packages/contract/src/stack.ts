// The PR's stack as GitHub has it NOW, read live for navigation, or the last
// one recorded once a closed PR has no live stack left. The brief carries its
// own snapshot from generation time; the header prefers this view when it
// has it, and the two differing is worth a line.
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
  /** Null when the PR sits in no open stack right now and none was recorded. */
  readonly stack: PrStackView | null;
  /** ISO time the served stack was recorded; present only for a recorded one. */
  readonly asOf?: string;
}
