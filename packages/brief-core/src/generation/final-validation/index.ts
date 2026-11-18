import { flagAddedSecrets } from "../added-secrets";
import { dropNoTestsOnExemptFiles } from "../no-tests-exempt-files";
import {
  flagPackageSourceChanges,
  readPackageSourceContext,
} from "../package-sources";
import type { PrFile } from "../../github/types";
import type {
  Brief,
  Chunk,
  IntentCheck,
  ReadingOrderStep,
  UnattributedFile,
} from "../../types";
import {
  buildConcernView,
  crossCheckFileTotals,
  deriveUnattributed,
  detectChunkOverlaps,
  unattributedTotals,
} from "../loc";
import {
  dropUnknownGroupChunks,
  validateIntentCheck,
  validatePartition,
  validateReadingOrder,
  validateRepoAttributeTokens,
  validateRiskAttributes,
  validateTextLength,
  type CheckedChunks,
} from "../validate";
import { listUnseenLinkIssues, removeUnseenLinks } from "../unseen-links";
import type { WarningCollector } from "../warnings/types";
import type { BriefValidationContext, FinalValidationArgs } from "./types";

function listCoverageIssues(
  chunks: readonly Chunk[],
  unattributed: readonly UnattributedFile[],
  prFiles: readonly PrFile[],
): string[] {
  const issues: string[] = [];

  if (unattributed.length > 0) {
    const gap = unattributedTotals([...unattributed]);
    issues.push(
      `${gap.added} added / ${gap.deleted} removed changed line(s) unattributed to any chunk across ${unattributed.length} file(s)`,
    );
  }

  const claimed = new Set(chunks.map((chunk) => chunk.file));
  const ungrouped = prFiles
    .map((file) => file.path)
    .filter((path) => !claimed.has(path));
  if (ungrouped.length > 0) {
    issues.push(
      `${String(ungrouped.length)} file(s) in no group — ${ungrouped.toSorted().join(", ")}`,
    );
  }

  return issues;
}

function validateOrder(
  brief: Brief,
  warnings: WarningCollector,
): ReadingOrderStep[] | undefined {
  const issues = validateReadingOrder(brief.readingOrder, brief.changeGroups);
  warnings.reportIssues("reading order", issues);

  if (issues.length > 0) {
    return undefined;
  }
  return brief.readingOrder;
}

function validateIntent(
  brief: Brief,
  context: BriefValidationContext,
  warnings: WarningCollector,
): IntentCheck | undefined {
  if (brief.intentCheck === undefined) {
    return undefined;
  }

  const checked = validateIntentCheck(
    brief.intentCheck,
    brief.changeGroups,
    context.injectedUrls,
    context.corpus,
    [],
    context.primaryFacts,
  );
  warnings.reportIssues("intent check", checked.issues);

  if (context.primaryTicket === undefined) {
    return checked.intentCheck;
  }
  return { ...checked.intentCheck, primaryTicket: context.primaryTicket };
}

/** A carried chunk keeps its tokens; this run's vocabulary binds regenerated chunks. */
function validateRegeneratedTokens(
  chunks: Chunk[],
  context: BriefValidationContext,
  carriedChunkIds: readonly string[],
): CheckedChunks<Chunk> {
  const { customAttributes } = context;
  if (customAttributes === undefined) {
    return { chunks, issues: [] };
  }

  const carried = new Set(carriedChunkIds);
  const issues: string[] = [];
  const checked = chunks.map((chunk) => {
    if (carried.has(chunk.id)) {
      return chunk;
    }
    const result = validateRepoAttributeTokens([chunk], customAttributes);
    issues.push(...result.issues);
    return result.chunks[0] ?? chunk;
  });

  return { chunks: checked, issues };
}

/**
 * The one validation pass, over the final group and chunk set of a fresh or
 * stitched brief. Every check warns; none fails the generation. Rollups and
 * the unattributed remainder derive here, after the last chunk drop.
 */
export function validateFinalBrief(args: FinalValidationArgs): Brief {
  const { context, carriedChunkIds, warnings } = args;
  const groups = args.brief.changeGroups;
  const changedFiles = [...context.changedFiles];

  const known = dropUnknownGroupChunks(groups, args.brief.chunks);
  warnings.reportIssues("unknown group", known.issues);

  warnings.reportIssues("loc overlap", detectChunkOverlaps(known.chunks));
  warnings.reportIssues(
    "loc cross-check",
    crossCheckFileTotals(changedFiles, [...context.prFiles]),
  );
  const unattributed = deriveUnattributed(known.chunks, changedFiles);
  warnings.reportIssues(
    "loc coverage",
    listCoverageIssues(known.chunks, unattributed, context.prFiles),
  );

  const readingOrder = validateOrder(args.brief, warnings);
  const intentCheck = validateIntent(args.brief, context, warnings);

  const tokens = validateRegeneratedTokens(
    known.chunks,
    context,
    carriedChunkIds,
  );
  warnings.reportIssues("repo attrs", tokens.issues);
  const risks = validateRiskAttributes(tokens.chunks, [...context.fileDiffs], {
    acceptsRevisionDroppedChecks: args.acceptsRevisionDroppedChecks,
  });
  warnings.reportIssues("risk attrs", risks.issues);
  const noTestsScoped = dropNoTestsOnExemptFiles(risks.chunks);
  const withSecrets = flagAddedSecrets(noTestsScoped, unattributed, [
    ...context.fileDiffs,
  ]);
  const flagged = flagPackageSourceChanges(
    withSecrets.chunks,
    withSecrets.unattributed,
    args.lockfileSummaries,
    readPackageSourceContext(context.fileDiffs),
    context.fileDiffs,
  );

  const textLength = validateTextLength(groups, flagged.chunks);
  warnings.reportIssues("text length", textLength.issues);
  warnings.reportIssues("partition", validatePartition(groups, flagged.chunks));
  const summary = removeUnseenLinks(args.brief.summary, context.prompt);
  warnings.reportIssues(
    "unseen links",
    listUnseenLinkIssues("summary", summary),
  );

  const {
    readingOrder: _unchecked,
    intentCheck: _unverified,
    lengthViolations: _stale,
    ...rest
  } = args.brief;
  const brief: Brief = {
    ...rest,
    summary: summary.text,
    chunks: flagged.chunks,
    concernView: buildConcernView(flagged.chunks),
    unattributed: flagged.unattributed,
  };

  if (readingOrder !== undefined) {
    brief.readingOrder = readingOrder;
  }
  if (intentCheck !== undefined) {
    brief.intentCheck = intentCheck;
  }
  if (textLength.violations.length > 0) {
    brief.lengthViolations = textLength.violations;
  }

  return brief;
}
