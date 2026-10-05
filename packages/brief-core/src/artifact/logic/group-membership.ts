import type { ChangeGroup, Chunk } from "../../types";
import {
  ArtifactIssueCodes,
  type ArtifactIssue,
  type ArtifactIssueCode,
  type GroupMembership,
  type GroupMembershipResult,
  type IdentifiedGroup,
  type SharedGroupIdIssues,
  type StoredChangeGroupRead,
  type StoredChunkRead,
} from "../types";

const {
  INVALID,
  LEGACY_MEMBERSHIP,
  MINTED_GROUP_ID,
  SHARED_GROUP_ID,
  UNKNOWN_CHANGE_GROUP,
} = ArtifactIssueCodes;
const GROUPS_PATH = "changeGroups";
const MINTED_ID = "Group had no id and was given the lowest free one";
const SHARED_ID = "Shares its id with an earlier change group";
const LEGACY_LIST = "Taken from the legacy chunk id lists on a group";
const NO_MEMBERSHIP = "Chunk belongs to no change group";
const UNKNOWN_GROUP = "Names no change group in this body";

function makeIssue(
  code: ArtifactIssueCode,
  path: string,
  message: string,
): ArtifactIssue {
  return { code, path, message };
}

function findFreeOrdinal(from: number, takenIds: ReadonlySet<string>): number {
  let ordinal = from;
  for (;;) {
    const isTaken = takenIds.has(`g${ordinal}`);
    if (!isTaken) {
      return ordinal;
    }
    ordinal += 1;
  }
}

/**
 * One id per group, by position. A minted id is the lowest free `g{n}` from the
 * group's one-based position, past every explicit id and every earlier mint.
 */
function identifyGroups(
  groups: readonly StoredChangeGroupRead[],
): IdentifiedGroup[] {
  const takenIds = new Set<string>();
  for (const group of groups) {
    if (group.id !== undefined) {
      takenIds.add(group.id);
    }
  }

  // Every ordinal between a mint and the next group's position is taken, so
  // the search resumes past the last mint and stays linear over the body.
  let lastMinted = 0;
  return groups.map((stored, position) => {
    if (stored.id !== undefined) {
      return { stored, id: stored.id };
    }

    const from = Math.max(position + 1, lastMinted + 1);
    lastMinted = findFreeOrdinal(from, takenIds);
    const id = `g${lastMinted}`;
    takenIds.add(id);
    return { stored, id };
  });
}

function stripLegacyLists(group: IdentifiedGroup): ChangeGroup {
  const {
    coreChunkIds: _core,
    supportingChunkIds: _supporting,
    ...kept
  } = group.stored;
  return { ...kept, id: group.id };
}

function reportMintedGroupIds(
  groups: readonly StoredChangeGroupRead[],
): ArtifactIssue[] {
  return groups.flatMap((group, position): ArtifactIssue[] => {
    if (group.id !== undefined) {
      return [];
    }
    const path = `changeGroups.${position}.id`;
    return [makeIssue(MINTED_GROUP_ID, path, MINTED_ID)];
  });
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

/** The first group to list a chunk owns it. */
function mapLegacyMembership(
  groups: readonly IdentifiedGroup[],
): Map<string, string> {
  const groupIdByChunkId = new Map<string, string>();

  for (const group of groups) {
    const listed = [
      ...(group.stored.coreChunkIds ?? []),
      ...(group.stored.supportingChunkIds ?? []),
    ];
    for (const chunkId of listed) {
      const isClaimed = groupIdByChunkId.has(chunkId);
      if (!isClaimed) {
        groupIdByChunkId.set(chunkId, group.id);
      }
    }
  }

  return groupIdByChunkId;
}

/** A chunk whose `changeGroupId` names no group is kept as stored. */
function reportUnknownChangeGroups(
  chunks: readonly Chunk[],
  changeGroups: readonly ChangeGroup[],
): ArtifactIssue[] {
  const groupIds = new Set(changeGroups.map((group) => group.id));

  return chunks.flatMap((chunk, position): ArtifactIssue[] => {
    const namesKnownGroup = groupIds.has(chunk.changeGroupId);
    if (namesKnownGroup) {
      return [];
    }
    const path = `chunks.${position}.changeGroupId`;
    return [makeIssue(UNKNOWN_CHANGE_GROUP, path, UNKNOWN_GROUP)];
  });
}

/**
 * Moves membership onto each chunk. A chunk's own `changeGroupId` wins over a
 * legacy list; a chunk with neither fails the read. Groups sharing an id are
 * kept as stored and reported.
 */
export function normalizeGroupMembership(
  groups: StoredChangeGroupRead[],
  storedChunks: StoredChunkRead[],
): GroupMembershipResult {
  const identified = identifyGroups(groups);
  const changeGroups = identified.map(stripLegacyLists);
  const legacyMembership = mapLegacyMembership(identified);
  const chunks: Chunk[] = [];
  const normalized: ArtifactIssue[] = [];
  const orphaned: ArtifactIssue[] = [];

  storedChunks.forEach((chunk, position) => {
    const path = `chunks.${position}.changeGroupId`;
    const changeGroupId = chunk.changeGroupId ?? legacyMembership.get(chunk.id);
    if (changeGroupId === undefined) {
      orphaned.push(makeIssue(INVALID, path, NO_MEMBERSHIP));
      return;
    }
    if (chunk.changeGroupId === undefined) {
      normalized.push(makeIssue(LEGACY_MEMBERSHIP, path, LEGACY_LIST));
    }
    chunks.push({ ...chunk, changeGroupId });
  });

  if (orphaned.length > 0) {
    return { ok: false, error: orphaned };
  }

  const membership: GroupMembership = {
    changeGroups,
    chunks,
    issues: [
      ...reportMintedGroupIds(groups),
      ...reportSharedGroupIds(identified, GROUPS_PATH, SHARED_GROUP_ID),
      ...normalized,
      ...reportUnknownChangeGroups(chunks, changeGroups),
    ],
  };
  return { ok: true, value: membership };
}
