import type { ChangeGroup } from "../../types";
import {
  ArtifactIssueCodes,
  type ArtifactIssue,
  type ArtifactIssueCode,
  type GroupMembership,
  type SharedGroupIdIssues,
  type StoredChunkRead,
} from "../types";

const { SHARED_GROUP_ID, UNKNOWN_CHANGE_GROUP } = ArtifactIssueCodes;
const GROUPS_PATH = "changeGroups";
const SHARED_ID = "Shares its id with an earlier change group";
const NO_MEMBERSHIP =
  "Chunk belongs to no change group: moved to the unattributed remainder";
const UNKNOWN_GROUP =
  "Names no change group in this body: moved to the unattributed remainder";

function makeIssue(
  code: ArtifactIssueCode,
  path: string,
  message: string,
): ArtifactIssue {
  return { code, path, message };
}

/**
 * One issue per later group repeating an id: chunks naming that id cannot be
 * told apart. The write check passes `INVALID`; the reader keeps the body.
 */
export function reportSharedGroupIds(
  groups: readonly Pick<ChangeGroup, "id">[],
  listPath: string,
  code: ArtifactIssueCode,
): SharedGroupIdIssues {
  const seenIds = new Set<string>();

  return groups.flatMap((group, position): ArtifactIssue[] => {
    const isRepeat = seenIds.has(group.id);
    if (!isRepeat) {
      seenIds.add(group.id);
      return [];
    }
    const path = `${listPath}.${position}.id`;
    return [makeIssue(code, path, SHARED_ID)];
  });
}

/**
 * A chunk with no `changeGroupId`, an empty one, or one naming no group is
 * split off for the remainder. Groups sharing an id are kept and reported.
 */
export function splitGroupMembership(
  changeGroups: ChangeGroup[],
  storedChunks: StoredChunkRead[],
): GroupMembership {
  const groupIds = new Set(changeGroups.map((group) => group.id));
  const membership: GroupMembership = {
    changeGroups,
    chunks: [],
    orphans: [],
    issues: reportSharedGroupIds(changeGroups, GROUPS_PATH, SHARED_GROUP_ID),
  };

  storedChunks.forEach((chunk, position) => {
    const path = `chunks.${position}.changeGroupId`;
    const { changeGroupId } = chunk;
    const isNamed = changeGroupId !== undefined && changeGroupId !== "";
    if (!isNamed) {
      membership.orphans.push(chunk);
      membership.issues.push(
        makeIssue(UNKNOWN_CHANGE_GROUP, path, NO_MEMBERSHIP),
      );
      return;
    }
    if (!groupIds.has(changeGroupId)) {
      membership.orphans.push(chunk);
      membership.issues.push(
        makeIssue(UNKNOWN_CHANGE_GROUP, path, UNKNOWN_GROUP),
      );
      return;
    }
    membership.chunks.push({ ...chunk, changeGroupId });
  });

  return membership;
}
