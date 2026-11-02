import {
  PrSpanFailureKinds,
  type PrSpanFailure,
  type PrSpanFailureKind,
} from "../types";

/** A retry cannot clear a refused size or an unreadable head, so either outranks a transient failure. */
const FAILURE_RANKS: Readonly<Record<PrSpanFailureKind, number>> = {
  [PrSpanFailureKinds.TOO_LARGE]: 2,
  [PrSpanFailureKinds.UNAVAILABLE]: 1,
  [PrSpanFailureKinds.TRANSIENT]: 0,
};

/** The one of two failures a retry is least likely to clear; the first on a tie. */
export function pickLastingFailure(
  first: PrSpanFailure,
  second: PrSpanFailure,
): PrSpanFailure {
  const secondOutranks = FAILURE_RANKS[second.kind] > FAILURE_RANKS[first.kind];
  return secondOutranks ? second : first;
}
