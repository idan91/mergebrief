import {
  buildPrimaryTicketText,
  DATA_REMINDER,
  readPrimary,
  renderBranchFacts,
  renderLinked,
  renderPrDescription,
  renderPrimaryTicket,
  renderPrTitle,
  REPO_REMINDER,
} from "../categorize";
import type { Outline } from "../outline/types";
import { buildGroupingSystemPrompt, renderGroupingAnchorView } from "../prompt";
import { stripForgedRepoFences } from "../repo-context";
import type { GroupingRequest, GroupingRequestInput } from "./types";

function describeDiff(
  fileCount: number,
  outline: Outline,
  hunkCount: number,
): string {
  return `## Diff (${fileCount} files, ${hunkCount} hunks, form: ${outline.form})`;
}

/**
 * The grouping call's user message: the PR text the single call renders,
 * minus the file list the outline's titles already carry, then the outline
 * in place of the diff. The outline is already sanitized; wrapping it is all
 * that happens here.
 */
export function buildGroupingRequest(
  input: GroupingRequestInput,
): GroupingRequest {
  const { pr, outline, fileCount, hunkCount, accepted, holdsMedia, anchor } =
    input;
  const clean =
    accepted.context === undefined
      ? (text: string) => text
      : stripForgedRepoFences;
  const primary = readPrimary(pr.primaryTicket);
  const primaryText =
    primary === undefined ? "" : buildPrimaryTicketText(primary);
  const primaryBlock = renderPrimaryTicket(primary, primaryText);
  const repoBlocks = accepted.instructionsBlock;
  const anchorBlock =
    anchor === undefined ? "" : `\n\n${renderGroupingAnchorView(anchor)}`;

  const user = `PR: ${pr.meta.url}
Repo: ${pr.locator.owner}/${pr.locator.repo}
Number: ${pr.locator.number}
Title: ${renderPrTitle(pr.meta)}${renderBranchFacts(pr.meta)}

## Description
${renderPrDescription(pr.meta)}

${clean(primaryBlock)}## Linked context
${clean(renderLinked(pr.links))}${repoBlocks}${clean(anchorBlock)}

${describeDiff(fileCount, outline, hunkCount)}
<pr_diff>
${outline.text}
</pr_diff>

Every \`[hunk <id>]\` marker above names one hunk (${hunkCount} in all) and a file title with no markers names a file assigned whole. Assign every one to exactly one change-group in \`hunkMap\`.

${DATA_REMINDER}${repoBlocks === "" ? "" : REPO_REMINDER}`;

  return {
    system: buildGroupingSystemPrompt(outline.form, {
      repoContext: accepted.context,
      anchored: anchor !== undefined,
      holdsMedia,
    }),
    user,
    primaryText,
  };
}
