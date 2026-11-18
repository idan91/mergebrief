import type { Brief } from "../../types";
import { stripKnownProseFences } from "../fences";
import {
  removeHiddenCharacters,
  sanitizeUntrustedText,
} from "../untrusted-text";
import type { AnchorViewInput } from "./types";

/** Union of a group's chunk files and risk attributes, order-stable. */
function collectGroupFacts(
  brief: Brief,
  groupId: string,
): { files: string[]; attrs: string[] } {
  const files: string[] = [];
  const attrs: string[] = [];
  for (const chunk of brief.chunks) {
    if (chunk.changeGroupId !== groupId) {
      continue;
    }
    if (!files.includes(chunk.file)) {
      files.push(chunk.file);
    }
    for (const attr of chunk.riskSurface) {
      if (!attrs.includes(attr)) {
        attrs.push(attr);
      }
    }
  }
  return { files, attrs };
}

/** One anchor-view line per previous intent item, tagged with its bucket. */
function renderIntentBucketLines(
  label: string,
  items: readonly {
    intent: string;
    quote: string;
    groupIds: readonly string[];
  }[],
): string[] {
  return items.map(
    (item) =>
      `- [${label}] ${sanitizeUntrustedText(item.intent)}${item.quote ? ` — "${sanitizeUntrustedText(item.quote)}"` : ""}${item.groupIds.length > 0 ? ` (groups: ${item.groupIds.join(", ")})` : ""}`,
  );
}

/** The previous alignment read; every full brief re-judges it against the current diff. */
function renderAlignmentLine(
  alignment: { read: string; goal: string; response: string } | undefined,
): string[] {
  if (alignment === undefined) {
    return [];
  }
  return [
    `- [alignment] ${sanitizeUntrustedText(alignment.read)} — "${sanitizeUntrustedText(alignment.goal)}" — ${sanitizeUntrustedText(alignment.response)}`,
  ];
}

/** Frozen and re-look groups, each in the previous brief's order. */
function partitionChangeGroups(input: AnchorViewInput) {
  const frozenSet = new Set(input.frozenGroupIds);
  const { changeGroups } = input.previousBrief;
  return {
    frozen: changeGroups.filter((group) => frozenSet.has(group.id)),
    reLook: changeGroups.filter((group) => !frozenSet.has(group.id)),
  };
}

/**
 * Render the Anchor section for an anchored generation's user message: frozen
 * index (no code), full previous definitions for re-look groups, summary and
 * intent verdicts verbatim, orderings as id sequences.
 */
export function renderAnchorView(input: AnchorViewInput): string {
  const { previousBrief } = input;

  function describeGroup(group: Brief["changeGroups"][number]): string {
    const categories = [
      group.dominantCategory,
      ...group.secondaryCategories,
    ].join(", ");
    const { files, attrs } = collectGroupFacts(previousBrief, group.id);
    const attrsPart = attrs.length > 0 ? `; attrs: ${attrs.join(", ")}` : "";
    const title = sanitizeUntrustedText(group.title);
    const summary = sanitizeUntrustedText(group.summary);
    const paths = files.map(sanitizeUntrustedText).join(", ") || "(none)";
    return `- ${group.id} [${categories}] ${title} — ${summary}\n  files: ${paths}${attrsPart}`;
  }

  const groups = partitionChangeGroups(input);
  const frozen = groups.frozen.map(describeGroup).join("\n");
  const reLook = groups.reLook.map(describeGroup).join("\n");

  const sections: string[] = [
    `## Anchor — previous brief (revision _${previousBrief.index})`,
    `### Frozen groups (carried verbatim by the pipeline — do NOT re-emit; their ids are claim targets only)\n${frozen || "(none)"}`,
    `### Groups to re-examine (previous take — keep what still holds)\n${reLook || "(none)"}`,
    `### Previous summary (verbatim — the base for your minimal edit)\n${sanitizeUntrustedText(previousBrief.summary)}`,
  ];

  sections.push(
    ...renderPreviousIntentSection(previousBrief),
    ...renderPreviousReadingOrderSection(previousBrief),
  );
  return wrapAnchorSections(previousBrief, sections);
}

/** The previous intent verdicts, as every anchored call reads them; none when the brief held no intent check. */
function renderPreviousIntentSection(previousBrief: Brief): string[] {
  const intent = previousBrief.intentCheck;
  if (intent === undefined) {
    return [];
  }

  const verdictLines = [
    `specificity: ${intent.specificity}`,
    ...renderIntentBucketLines("accomplished", intent.accomplished),
    ...renderIntentBucketLines("statedButMissing", intent.statedButMissing),
    ...renderIntentBucketLines("doneButUnstated", intent.doneButUnstated),
    ...renderIntentBucketLines("deviations", intent.deviations),
    ...renderIntentBucketLines("maskedFixes", intent.maskedFixes),
    ...renderAlignmentLine(intent.alignment),
  ];
  return [
    `### Previous intent verdicts (re-judge against the CURRENT ask; anchor wording only)\n${verdictLines.join("\n")}`,
  ];
}

/** The previous reading order as an id sequence; none when the brief held no order. */
function renderPreviousReadingOrderSection(previousBrief: Brief): string[] {
  if (previousBrief.readingOrder === undefined) {
    return [];
  }

  return [
    `### Previous reading order (id sequence)\n${previousBrief.readingOrder.map((step) => step.groupId).join(", ")}`,
  ];
}

function wrapAnchorSections(
  previousBrief: Brief,
  sections: readonly string[],
): string {
  // Each field is sanitized like PR text on its own, since an unclosed opener
  // hides the rest of the text it sits in; the join, ids included, only loses
  // hidden characters and forged tags.
  const joined = removeHiddenCharacters(sections.join("\n\n"));
  const body = stripKnownProseFences(joined);
  return `<anchor_brief index="${previousBrief.index}">\n${body}\n</anchor_brief>`;
}

/**
 * The Anchor of an anchored grouping call: frozen groups as a code-free
 * index (id, categories, title, files) the call may never list or map,
 * previous takes of the groups to re-examine, then the summary, intent
 * verdicts and reading order the single call reads too.
 */
export function renderGroupingAnchorView(input: AnchorViewInput): string {
  const { previousBrief } = input;

  function describeFrozen(group: Brief["changeGroups"][number]): string {
    const categories = [
      group.dominantCategory,
      ...group.secondaryCategories,
    ].join(", ");
    const { files } = collectGroupFacts(previousBrief, group.id);
    const paths = files.map(sanitizeUntrustedText).join(", ") || "(none)";
    return `- ${group.id} [${categories}] ${sanitizeUntrustedText(group.title)}\n  files: ${paths}`;
  }
  function describeReLook(group: Brief["changeGroups"][number]): string {
    const summary = sanitizeUntrustedText(group.summary);
    return `${describeFrozen(group)}\n  previous summary: ${summary}`;
  }

  const groups = partitionChangeGroups(input);
  const frozen = groups.frozen.map(describeFrozen).join("\n");
  const reLook = groups.reLook.map(describeReLook).join("\n");

  const sections: string[] = [
    `## Anchor, previous brief (revision _${previousBrief.index})`,
    `### Frozen groups (carried verbatim by the pipeline; never list them in changeGroups or map a hunk to them)\n${frozen || "(none)"}`,
    `### Groups to re-examine (previous take; keep what still holds)\n${reLook || "(none)"}`,
    `### Previous summary (verbatim, the base for your minimal edit)\n${sanitizeUntrustedText(previousBrief.summary)}`,
    ...renderPreviousIntentSection(previousBrief),
    ...renderPreviousReadingOrderSection(previousBrief),
  ];
  return wrapAnchorSections(previousBrief, sections);
}
