import { insertSlipSteps } from "../../anchoring";
import type { FileId, IndexedFile } from "../../diff/hunk-index/types";
import type { ChangeGroup, HunkMapEntry, StoredGrouping } from "../../types";
import type { AnchorViewInput } from "../prompt";
import {
  createGroupIdRestorer,
  restoreEscapedHeadings,
  restoreGroupReferences,
  sanitizeUntrustedLine,
} from "../untrusted-text";
import type { WarningCollector } from "../warnings/types";
import type { MultiCallAnchor } from "./types";

const FROZEN_GROUP_CHECK = "frozen group";
/** A slip group's id until the stitch descends it; never a final id. */
const TEMPORARY_GROUP_ID_PREFIX = "t";

export function readAnchorView(
  anchor: MultiCallAnchor | undefined,
): AnchorViewInput | undefined {
  if (anchor === undefined) {
    return undefined;
  }
  return {
    previousBrief: anchor.previousBrief,
    frozenGroupIds: anchor.plan.frozen.map((carry) => carry.group.id),
  };
}

/**
 * The grouping with what it copied off the Anchor spelled as stored: each
 * summary heading shown escaped, and each group id shown on one line.
 */
export function restoreAnchorSpellings(
  grouping: StoredGrouping,
  anchor: MultiCallAnchor | undefined,
): StoredGrouping {
  if (anchor === undefined) {
    return grouping;
  }
  const { previousBrief } = anchor;
  const rawGroupIds = previousBrief.changeGroups.map((group) => group.id);
  const restoreGroupId = createGroupIdRestorer(rawGroupIds);

  return {
    ...grouping,
    ...restoreGroupReferences(grouping, rawGroupIds),
    summary: restoreEscapedHeadings(grouping.summary, previousBrief.summary),
    hunkMap: grouping.hunkMap.map((entry) => ({
      ...entry,
      groupId: restoreGroupId(entry.groupId),
    })),
  };
}

/** The files a run groups and details: all of them, or with an anchor only those outside its frozen groups. */
export function listReLookFiles(
  files: readonly IndexedFile[],
  anchor: MultiCallAnchor | undefined,
): IndexedFile[] {
  if (anchor === undefined) {
    return [...files];
  }
  return files.filter((file) => !anchor.plan.frozenFiles.has(file.path));
}

/** The ids of the files an anchored run leaves out of its outline. */
export function listOmittedFileIds(
  files: readonly IndexedFile[],
  anchor: MultiCallAnchor | undefined,
): Set<FileId> {
  if (anchor === undefined) {
    return new Set();
  }
  const omitted = files.filter((file) =>
    anchor.plan.frozenFiles.has(file.path),
  );
  return new Set(omitted.map((file) => file.id));
}

function mintTemporaryIds(
  slipIds: readonly string[],
  takenIds: ReadonlySet<string>,
): Map<string, string> {
  const renames = new Map<string, string>();
  let counter = 1;
  for (const id of slipIds) {
    while (takenIds.has(`${TEMPORARY_GROUP_ID_PREFIX}${counter}`)) {
      counter += 1;
    }
    renames.set(id, `${TEMPORARY_GROUP_ID_PREFIX}${counter}`);
    counter += 1;
  }
  return renames;
}

function renameGroup(
  group: ChangeGroup,
  renames: ReadonlyMap<string, string>,
): ChangeGroup {
  const id = renames.get(group.id);
  return id === undefined ? group : { ...group, id };
}

function renameEntry(
  entry: HunkMapEntry,
  renames: ReadonlyMap<string, string>,
): HunkMapEntry {
  const groupId = renames.get(entry.groupId);
  return groupId === undefined ? entry : { ...entry, groupId };
}

/**
 * The grouping never sees a frozen file, so a group it lists under a frozen
 * id is a numbering slip: it takes a temporary id the stitch then descends,
 * and its hunk-map entries follow it. An entry naming a frozen id no group
 * lists names no group and drops; reading-order and intent references to a
 * frozen id stay on the carried group, and the slip group's step follows it.
 */
export function renameListedFrozenGroups(
  grouping: StoredGrouping,
  anchor: MultiCallAnchor | undefined,
  warnings: WarningCollector,
): StoredGrouping {
  if (anchor === undefined) {
    return grouping;
  }
  const frozenIds = new Set(anchor.plan.frozen.map((carry) => carry.group.id));
  const listedIds = grouping.changeGroups.map((group) => group.id);
  const slipIds = [...new Set(listedIds.filter((id) => frozenIds.has(id)))];
  if (slipIds.length === 0) {
    return grouping;
  }

  // A stored id is shown on one line, so that spelling is taken too.
  const knownIds = [
    ...frozenIds,
    ...anchor.plan.previousGroupIds,
    ...listedIds,
  ];
  const takenIds = new Set([
    ...knownIds,
    ...knownIds.map(sanitizeUntrustedLine),
  ]);
  const renames = mintTemporaryIds(slipIds, takenIds);
  warnings.reportIssues(
    FROZEN_GROUP_CHECK,
    [...renames].map(
      ([id, temporaryId]) =>
        `grouping listed frozen group ${id}; its group descends as ${temporaryId}`,
    ),
  );
  const changeGroups = grouping.changeGroups.map((group) =>
    renameGroup(group, renames),
  );
  const renamed: StoredGrouping = {
    ...grouping,
    changeGroups,
    hunkMap: grouping.hunkMap.map((entry) => renameEntry(entry, renames)),
  };
  if (grouping.readingOrder !== undefined) {
    const slips = new Map<string, ChangeGroup>();
    for (const [id, temporaryId] of renames) {
      const group = changeGroups.find((listed) => listed.id === temporaryId);
      if (group !== undefined) {
        slips.set(id, group);
      }
    }
    renamed.readingOrder = insertSlipSteps(grouping.readingOrder, slips);
  }
  return renamed;
}
