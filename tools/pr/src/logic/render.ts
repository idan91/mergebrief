import type { Activity, PullStatus, StackStatus } from "../types";

const SHORT_SHA = 10;

function shortSha(sha: string): string {
  return sha.slice(0, SHORT_SHA);
}

function renderBase(status: PullStatus): string {
  if (status.baseAligned === true) {
    return "aligned";
  }
  if (status.baseAligned === false) {
    return `BEHIND ${status.pull.base}: rebase onto it`;
  }
  return "unknown (fetch or merge-base failed)";
}

const THREAD_PAGE_NOTE = "more threads exist, check the PR";

function renderThreads(status: PullStatus): string {
  const truncated = status.pull.threadsTruncated;
  if (status.openThreads.length === 0) {
    return truncated
      ? `none open in the first 100; ${THREAD_PAGE_NOTE}`
      : "none open";
  }
  const items = status.openThreads.map((thread) => {
    const line = thread.line === undefined ? "" : `:${thread.line}`;
    const outdated = thread.isOutdated ? " outdated" : "";
    return `${thread.rootId} ${thread.path}${line} (${thread.lastAuthor} ${thread.lastAt}${outdated})`;
  });
  const note = truncated ? `; ${THREAD_PAGE_NOTE}` : "";
  return `${items.length} open: ${items.join("; ")}${note}`;
}

function renderActivity(activity: readonly Activity[]): string {
  if (activity.length === 0) {
    return "nothing new";
  }
  const items = activity.map((item) => {
    const state = item.state === undefined ? "" : ` ${item.state}`;
    return `${item.kind}${state} by ${item.author} ${item.at}`;
  });
  return `${items.length} ${items.join("; ")}`;
}

function renderPull(status: PullStatus): string[] {
  const { pull } = status;
  const draft = pull.isDraft ? " draft" : "";
  const header = `#${pull.number} ${pull.state.toLowerCase()}${draft}  ${pull.head} -> ${pull.base}  head ${shortSha(pull.headSha)}`;
  if (!status.isOpen) {
    return [header];
  }
  return [
    header,
    `  base     ${renderBase(status)}`,
    `  threads  ${renderThreads(status)}`,
    `  since head ${renderActivity(status.activityAfterHead)}`,
  ];
}

function renderCheckout(stack: StackStatus): string {
  const { checkout, top } = stack;
  const dirty = checkout.isDirty ? " (uncommitted changes)" : "";
  const where = `${checkout.branch ?? "detached"} at ${shortSha(checkout.headSha)}${dirty}`;
  if (top === undefined) {
    return `checkout ${where}`;
  }
  const onTop =
    checkout.branch === top.head && checkout.headSha === top.headSha;
  if (onTop) {
    return `checkout ${where}, matches the top PR`;
  }
  return `checkout ${where}, NOT the top PR ${top.head} at ${shortSha(top.headSha)}`;
}

export function renderStackStatus(stack: StackStatus): string {
  return [...stack.pulls.flatMap(renderPull), renderCheckout(stack)].join("\n");
}
