import type { TFunction } from "i18next";

import { PrStackMemberStates, type PrStackMemberState } from "contract";
import { PrStates } from "types";
import { buildGithubPullUrl } from "@web/utils/github-pull-url";
import { UnknownValues } from "@web/utils/open-enum/types";
import { PR_STATE_BADGE_LABEL_KEYS } from "../consts";
import { PrStateBadgeVariants, type PrStateBadgeVariant } from "../types";
import { buildBriefSearchParams } from "../../../../model/comparison/compare-state";
import type {
  LinearPrStack,
  LivePrState,
  PrStack,
  PrStackMember,
  PullStack,
} from "../../../../model/types";
import {
  NeighbourTargetKinds,
  StackDirections,
  StackVersions,
  type NeighbourTarget,
  type StackArrowView,
  type StackDirection,
  type StackNeighbours,
  type StackRow,
  type StackVersion,
  type StackView,
} from "./types";

/**
 * A stack neighbour opens as its full brief: with no view named, a reviewer
 * holding a checkpoint on it would land in Changes Only.
 */
const STACK_LANDING_SEARCH = buildBriefSearchParams("full", undefined);

export function isLinearPrStack(stack: PrStack): stack is LinearPrStack {
  return "members" in stack;
}

function sameMembers(
  left: readonly PrStackMember[],
  right: readonly PrStackMember[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((member, index) => member.number === right[index]?.number);
}

/** Same PRs in the same places; titles are display and do not count. */
export function isSameStack(left: PrStack, right: PrStack): boolean {
  if (isLinearPrStack(left) && isLinearPrStack(right)) {
    return (
      left.index === right.index && sameMembers(left.members, right.members)
    );
  }
  if (isLinearPrStack(left) || isLinearPrStack(right)) {
    return false;
  }
  const sameParent = left.parent?.number === right.parent?.number;
  return sameParent && sameMembers(left.children, right.children);
}

/**
 * Which stack the chip shows. The read wins once it has answered, carrying
 * the record's `asOf` when that is what it served; the generation-time one
 * stands in until then, and rides along as `snapshot` when the two disagree.
 * A stackless answer hides the chip on an open PR, since GitHub sees no stack,
 * and on a closed one means nothing was ever recorded, so the snapshot is
 * the last stack anyone saw.
 */
export function resolveStackView(
  snapshot: PrStack | undefined,
  live: PullStack | undefined,
  state: LivePrState["state"] | undefined,
): StackView | undefined {
  if (live === undefined) {
    return snapshot === undefined ? undefined : { stack: snapshot };
  }
  if (live.stack === undefined) {
    return resolveClosedFallback(snapshot, state);
  }

  const view: StackView = { stack: live.stack };
  if (live.asOf !== undefined) {
    view.asOf = live.asOf;
  }
  if (snapshot !== undefined && !isSameStack(live.stack, snapshot)) {
    view.snapshot = snapshot;
  }
  return view;
}

/** The stack the panel lists: the brief's only while it is chosen and differs. */
export function resolveShownStack(
  stack: PrStack,
  snapshot: PrStack | undefined,
  version: StackVersion,
): PrStack {
  if (snapshot === undefined || version === StackVersions.NOW) {
    return stack;
  }
  return snapshot;
}

function resolveClosedFallback(
  snapshot: PrStack | undefined,
  state: LivePrState["state"] | undefined,
): StackView | undefined {
  const closed = state === PrStates.CLOSED || state === PrStates.MERGED;
  if (!closed || snapshot === undefined) {
    return undefined;
  }
  return { stack: snapshot, atGeneration: true };
}

/**
 * The app route when the repo is known, the member's page on GitHub otherwise.
 */
export function resolveNeighbourTarget(
  member: PrStackMember,
  repoId: string | undefined,
  repoSlug: string,
): NeighbourTarget {
  if (repoId !== undefined) {
    return {
      kind: NeighbourTargetKinds.ROUTE,
      params: { repoId, prNumber: String(member.number) },
      search: STACK_LANDING_SEARCH,
    };
  }
  const href = buildGithubPullUrl(repoSlug, member.number);
  if (href === undefined) {
    return { kind: NeighbourTargetKinds.NONE };
  }
  return { kind: NeighbourTargetKinds.GITHUB, href };
}

/** A fork, or a stack this PR is not in, has no previous and next. */
export function resolveStackNeighbours(
  stack: PrStack,
  currentNumber: number,
): StackNeighbours | undefined {
  if (!isLinearPrStack(stack)) {
    return undefined;
  }
  const position = stack.members.findIndex(
    (member) => member.number === currentNumber,
  );
  if (position === -1) {
    return undefined;
  }

  const neighbours: StackNeighbours = {};
  const previous = stack.members[position - 1];
  const next = stack.members[position + 1];
  if (previous !== undefined) {
    neighbours.previous = previous;
  }
  if (next !== undefined) {
    neighbours.next = next;
  }
  return neighbours;
}

/**
 * The arrow toward `member`, named for AT with its number and title; an end
 * of the stack, or a member with nowhere to go, reads as having none.
 */
export function resolveStackArrow(
  t: TFunction,
  direction: StackDirection,
  member: PrStackMember | undefined,
  repoId: string | undefined,
  repoSlug: string,
): StackArrowView {
  const previous = direction === StackDirections.PREVIOUS;
  if (member === undefined) {
    const none = previous
      ? t("brief.header.stackPreviousNone")
      : t("brief.header.stackNextNone");
    return {
      label: none,
      target: { kind: NeighbourTargetKinds.NONE },
      disabled: true,
    };
  }

  const values = { number: member.number, title: member.title };
  const named = previous
    ? t("brief.header.stackPrevious", values)
    : t("brief.header.stackNext", values);
  const target = resolveNeighbourTarget(member, repoId, repoSlug);
  const disabled = target.kind === NeighbourTargetKinds.NONE;
  if (target.kind === NeighbourTargetKinds.GITHUB) {
    return { label: `${named}${t("a11y.opensInNewTab")}`, target, disabled };
  }
  return { label: named, target, disabled };
}

const MEMBER_STATE_VARIANTS: Record<PrStackMemberState, PrStateBadgeVariant> = {
  [PrStackMemberStates.OPEN]: PrStateBadgeVariants.OPEN,
  [PrStackMemberStates.DRAFT]: PrStateBadgeVariants.DRAFT,
};

/** The glyph a member's state draws; none for a recorded member or a state this bundle predates. */
export function resolveMemberStateVariant(
  state: PrStackMember["state"],
): PrStateBadgeVariant | undefined {
  if (state === undefined || state === UnknownValues.UNKNOWN) {
    return undefined;
  }
  return MEMBER_STATE_VARIANTS[state];
}

/**
 * A member's accessible name: number and title, then its state and branch
 * when the live read knows them, since the row's label replaces its content.
 */
export function resolveStackMemberLabel(
  t: TFunction,
  member: PrStackMember,
): string {
  let label: string = t("brief.header.stackMember", {
    number: member.number,
    title: member.title,
  });
  const stateVariant = resolveMemberStateVariant(member.state);
  if (stateVariant !== undefined) {
    const detail = t(PR_STATE_BADGE_LABEL_KEYS[stateVariant]);
    label = t("brief.header.stackMemberDetail", { member: label, detail });
  }
  if (member.headRef !== undefined) {
    label = t("brief.header.stackMemberDetail", {
      member: label,
      detail: member.headRef,
    });
  }
  return label;
}

/** A chain's rows tip first, each numbered from the base, as the list shows them. */
export function deriveChainRows(
  members: readonly PrStackMember[],
  currentNumber: number,
): StackRow[] {
  const rows = members.map(
    (member, index): StackRow => ({
      member,
      position: index + 1,
      current: member.number === currentNumber,
    }),
  );
  return rows.toReversed();
}

/** A fork's parent or children as given: siblings have no place to number. */
export function deriveForkRows(
  members: readonly PrStackMember[],
  currentNumber: number,
): StackRow[] {
  return members.map((member) => ({
    member,
    current: member.number === currentNumber,
  }));
}

/** The scroll offset that centres a row of `rowHeight` starting at `rowTop`, never above the top. */
export function resolveCentredScrollTop(
  rowTop: number,
  rowHeight: number,
  viewportHeight: number,
): number {
  const centred = rowTop - (viewportHeight - rowHeight) / 2;
  return Math.max(0, centred);
}

/**
 * Centre the current row in its scroller. The row's top is the sum of the
 * rows before it: the current row is sticky, so its own offsetTop reports
 * where it is stuck, not where it sits.
 */
export function centreCurrentRow(scroller: HTMLElement): void {
  const current = scroller.querySelector("[aria-current]")?.closest("li");
  if (!(current instanceof HTMLElement)) {
    return;
  }

  let rowTop = 0;
  let sibling = current.previousElementSibling;
  while (sibling instanceof HTMLElement) {
    rowTop += sibling.offsetHeight;
    sibling = sibling.previousElementSibling;
  }
  scroller.scrollTop = resolveCentredScrollTop(
    rowTop,
    current.offsetHeight,
    scroller.clientHeight,
  );
}

/**
 * Centre the current row now and again whenever the scroller resizes, until
 * the reader scrolls it: a scroll landing anywhere but the last centring is
 * theirs. Returns the teardown.
 */
export function keepCurrentRowCentred(scroller: HTMLElement): () => void {
  let centredTop = scroller.scrollTop;
  let readerScrolled = false;
  const centre = () => {
    if (readerScrolled) {
      return;
    }
    centreCurrentRow(scroller);
    centredTop = scroller.scrollTop;
  };
  const noteScroll = () => {
    if (scroller.scrollTop !== centredTop) {
      readerScrolled = true;
    }
  };

  centre();
  scroller.addEventListener("scroll", noteScroll);
  const observer = new ResizeObserver(centre);
  observer.observe(scroller);
  return () => {
    observer.disconnect();
    scroller.removeEventListener("scroll", noteScroll);
  };
}
