/**
 * Id-descent matcher (BRIEF-143): after an anchored generation, the pipeline
 * rewrites the model's temporary group ids by file-overlap descent so DB ids
 * stay canonical revision to revision (retiring the ADR 0018 D7/D12
 * dangling-id hazard). A re-looked/new group inherits the id of the previous
 * group it shares the most files with — merge → dominant parent's id; split
 * → the dominant child keeps it, the others mint; unmatched → mint. Frozen
 * groups keep their ids by construction and enter only as `reservedIds`.
 * Deterministic and order-stable: ties resolve to the FIRST candidate in
 * input order, and minted ids are a monotone counter skipping every id in
 * play.
 */

/** A group reduced to what descent needs: its id and its chunk file set. */
export interface DescentGroup {
  readonly id: string;
  readonly files: readonly string[];
}

export interface AssignGroupIdsArgs {
  /** Generated (re-looked + new) groups, model temp ids. */
  readonly generated: readonly DescentGroup[];
  /** Previous groups eligible for descent (the re-looked ones). */
  readonly previous: readonly DescentGroup[];
  /**
   * Ids that must never be minted (or inherited): the frozen groups' carried
   * ids, plus any retired ids the caller wants kept dead — pass every id the
   * PR's brief chain has ever used where available, so a group id retired at
   * an earlier revision is never resurrected for an unrelated group.
   */
  readonly reservedIds: readonly string[];
}

function overlapCount(a: readonly string[], b: ReadonlySet<string>): number {
  let count = 0;
  for (const file of new Set(a)) {
    if (b.has(file)) count++;
  }
  return count;
}

/** Map every generated temp id to its final pipeline-owned id. */
export function assignGroupIds(args: AssignGroupIdsArgs): Map<string, string> {
  const { generated, previous, reservedIds } = args;
  const previousFileSets = previous.map((group) => ({
    id: group.id,
    files: new Set(group.files),
  }));

  // Pass 1 — dominant parent per generated group (merge rule): the previous
  // group sharing the most files; ties → first previous in input order.
  const wantedParent = new Map<string, string>();
  for (const group of generated) {
    let bestId: string | undefined;
    let bestCount = 0;
    for (const parent of previousFileSets) {
      const count = overlapCount(group.files, parent.files);
      if (count > bestCount) {
        bestCount = count;
        bestId = parent.id;
      }
    }
    if (bestId !== undefined) wantedParent.set(group.id, bestId);
  }

  // Pass 2 — dominant child per parent (split rule): among generated groups
  // wanting the same parent, the one sharing the most files keeps the id;
  // ties → first generated in input order.
  const parentWinner = new Map<string, string>();
  for (const parent of previousFileSets) {
    let winner: string | undefined;
    let bestCount = 0;
    for (const group of generated) {
      if (wantedParent.get(group.id) !== parent.id) continue;
      const count = overlapCount(group.files, parent.files);
      if (count > bestCount) {
        bestCount = count;
        winner = group.id;
      }
    }
    if (winner !== undefined) parentWinner.set(parent.id, winner);
  }

  // Pass 3 — assign: winners inherit; everyone else mints from a counter
  // that skips every id in play (reserved, previous, already assigned).
  const taken = new Set<string>(reservedIds);
  for (const parent of previous) taken.add(parent.id);
  const assigned = new Map<string, string>();
  let mintCounter = 1;
  const mint = (): string => {
    let candidate = `g${mintCounter}`;
    while (taken.has(candidate)) {
      mintCounter++;
      candidate = `g${mintCounter}`;
    }
    taken.add(candidate);
    return candidate;
  };
  for (const group of generated) {
    const parentId = wantedParent.get(group.id);
    if (parentId !== undefined && parentWinner.get(parentId) === group.id) {
      assigned.set(group.id, parentId);
      taken.add(parentId);
    } else {
      assigned.set(group.id, mint());
    }
  }
  return assigned;
}
