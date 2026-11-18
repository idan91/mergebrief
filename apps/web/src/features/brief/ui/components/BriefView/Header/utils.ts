export interface CollapsePoint {
  x: number;
  y: number;
}

/** Where the moving parts of the Header sit, measured either side of a collapse. */
export interface CollapseLayout {
  barBottom: number;
  comparisonTop: number;
  identityCentre: number;
  metaTop: number;
  /** The title's neighbours on its line, in DOM order. */
  titleNeighbours: readonly CollapsePoint[];
  title: CollapsePoint;
  titleFontPixels: number;
}

/** The offset each part starts from so it paints where it was before the swap. */
export interface CollapseShifts {
  bar: number;
  comparison: number;
  identity: number;
  meta: number;
  titleNeighbours: readonly CollapsePoint[];
  title: CollapsePoint;
  titleScale: number;
}

/** Where the outgoing title's ghost starts and ends, from its resting origin. */
export interface GhostPath {
  from: CollapsePoint;
  to: CollapsePoint;
  endScale: number;
}

export interface GhostPathInput {
  start: CollapseLayout;
  end: CollapseLayout;
  ghostOrigin: CollapsePoint;
  shifts: CollapseShifts;
}

/**
 * The FLIP offsets between two layouts. The title, its neighbours and the meta
 * line all sit inside the identity row, so their offsets leave out the one the
 * row already carries.
 */
export function deriveCollapseShifts(
  start: CollapseLayout,
  end: CollapseLayout,
): CollapseShifts {
  const identity = start.identityCentre - end.identityCentre;
  const shiftInsideRow = (from: CollapsePoint, to: CollapsePoint) => ({
    x: from.x - to.x,
    y: from.y - to.y - identity,
  });
  const titleNeighbours = end.titleNeighbours.map((neighbour, index) =>
    shiftInsideRow(start.titleNeighbours[index] ?? neighbour, neighbour),
  );

  return {
    bar: start.barBottom - end.barBottom,
    comparison: start.comparisonTop - end.comparisonTop,
    identity,
    meta: start.metaTop - end.metaTop - identity,
    titleNeighbours,
    title: shiftInsideRow(start.title, end.title),
    titleScale: start.titleFontPixels / end.titleFontPixels,
  };
}

/**
 * The ghost sits inside the identity row, which already carries its own
 * offset, so the start leaves that offset out.
 */
export function deriveGhostPath({
  start,
  end,
  ghostOrigin,
  shifts,
}: GhostPathInput): GhostPath {
  return {
    from: {
      x: start.title.x - ghostOrigin.x,
      y: start.title.y - ghostOrigin.y - shifts.identity,
    },
    to: {
      x: end.title.x - ghostOrigin.x,
      y: end.title.y - ghostOrigin.y,
    },
    endScale: 1 / shifts.titleScale,
  };
}

/**
 * A phone's collapse changes no box, so there is nothing to play. An unmeasured
 * font size gives a NaN scale, which is no movement.
 */
export function hasCollapseMovement(shifts: CollapseShifts): boolean {
  const titleResizes =
    Number.isFinite(shifts.titleScale) && shifts.titleScale !== 1;
  const moves = shifts.bar !== 0 || titleResizes;
  return moves;
}
