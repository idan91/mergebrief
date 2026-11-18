import type { RootContent } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { MARKDOWN_REMARK_PLUGINS } from "./consts";

const CHANGELOG_HEADING_DEPTH = 2;
const CHANGELOG_HEADING_TEXT = "changelog";

/** A Brief summary cut at its changelog heading, as the renderer parses it. */
export interface BriefSummaryParts {
  lede: string;
  /** From the `## Changelog` heading to the end; absent when the summary has none. */
  changelog?: string;
}

function isChangelogHeading(node: RootContent): boolean {
  if (node.type !== "heading" || node.depth !== CHANGELOG_HEADING_DEPTH) {
    return false;
  }
  const [only, ...rest] = node.children;
  const singleText = only?.type === "text" && rest.length === 0;
  if (!singleText) {
    return false;
  }
  const headingText = only.value.trim().toLowerCase();
  return headingText === CHANGELOG_HEADING_TEXT;
}

/** Splits `summary` before its first top-level `## Changelog` heading. */
export function splitBriefSummary(summary: string): BriefSummaryParts {
  const tree = unified()
    .use(remarkParse)
    .use(MARKDOWN_REMARK_PLUGINS)
    .parse(summary);
  const heading = tree.children.find(isChangelogHeading);
  const offset = heading?.position?.start.offset;
  if (offset === undefined) {
    return { lede: summary };
  }

  return {
    lede: summary.slice(0, offset).trimEnd(),
    changelog: summary.slice(offset),
  };
}
