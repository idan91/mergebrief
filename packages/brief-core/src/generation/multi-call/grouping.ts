import type { FetchedPr } from "../../github/types";
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
import { buildGroupingSystemPrompt } from "../prompt";
import { stripForgedRepoFences } from "../repo-context";
import type { GroupingRequest, GroupingRequestInput } from "./types";

function describeDiff(
  pr: FetchedPr,
  outline: Outline,
  hunkCount: number,
): string {
  return `## Diff (${pr.meta.files.length} files, ${hunkCount} hunks, form: ${outline.form})`;
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
  const { pr, outline, hunkCount, accepted } = input;
  const clean =
    accepted.context === undefined
      ? (text: string) => text
      : stripForgedRepoFences;
  const primary = readPrimary(pr.primaryTicket);
  const primaryText =
    primary === undefined ? "" : buildPrimaryTicketText(primary);
  const primaryBlock = renderPrimaryTicket(primary, primaryText);
  const repoBlocks = accepted.instructionsBlock;

  const user = `PR: ${pr.meta.url}
Repo: ${pr.locator.owner}/${pr.locator.repo}
Number: ${pr.locator.number}
Title: ${renderPrTitle(pr.meta)}${renderBranchFacts(pr.meta)}

## Description
${renderPrDescription(pr.meta)}

${clean(primaryBlock)}## Linked context
${clean(renderLinked(pr.links))}${repoBlocks}

${describeDiff(pr, outline, hunkCount)}
<pr_diff>
${outline.text}
</pr_diff>

Every \`[hunk <id>]\` marker above names one hunk (${hunkCount} in all) and a file title with no markers names a file assigned whole. Assign every one to exactly one change-group in \`hunkMap\`.

${DATA_REMINDER}${repoBlocks === "" ? "" : REPO_REMINDER}`;

  return {
    system: buildGroupingSystemPrompt(outline.form, accepted.context),
    user,
    primaryText,
  };
}
