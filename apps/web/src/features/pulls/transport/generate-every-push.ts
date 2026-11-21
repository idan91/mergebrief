// The two every-push writes: one route turns the switch on, the other off.
// A refusal reads as not-allowed unless the instance does not list the
// account; the switch's state is the meta's to say.
import { ProductActionIds } from "contract";

import { ApiErrorCodes } from "../../../data/apiFetch";
import { readFailureKind, request } from "../../../data/request";
import type { WriteKindTable } from "../../../data/request/types";
import {
  EveryPushResultKinds,
  type EveryPushResult,
  type EveryPushResultKind,
} from "../types";

type EveryPushFailureKind = Exclude<
  EveryPushResultKind,
  typeof EveryPushResultKinds.SAVED
>;

const EveryPushKinds: WriteKindTable<EveryPushFailureKind> = {
  [ApiErrorCodes.NOT_FOUND]: EveryPushResultKinds.NOT_ALLOWED,
  [ApiErrorCodes.FORBIDDEN]: EveryPushResultKinds.NOT_ALLOWED,
  [ApiErrorCodes.HUMAN_ONLY]: EveryPushResultKinds.NOT_ALLOWED,
  [ApiErrorCodes.ACCOUNT_NOT_ALLOWED]: EveryPushResultKinds.ACCOUNT_NOT_ALLOWED,
  [ApiErrorCodes.MALFORMED]: EveryPushResultKinds.INDETERMINATE,
  fallback: EveryPushResultKinds.UPSTREAM,
};

export async function turnOnGenerateEveryPush(
  repoId: string,
  prNumber: number,
): Promise<EveryPushResult> {
  try {
    await request(ProductActionIds.TURN_ON_GENERATE_EVERY_PUSH, {
      params: { repoId, prNumber },
    });
    return { kind: EveryPushResultKinds.SAVED };
  } catch (error) {
    return { kind: readFailureKind(error, EveryPushKinds) };
  }
}

export async function turnOffGenerateEveryPush(
  repoId: string,
  prNumber: number,
): Promise<EveryPushResult> {
  try {
    await request(ProductActionIds.TURN_OFF_GENERATE_EVERY_PUSH, {
      params: { repoId, prNumber },
    });
    return { kind: EveryPushResultKinds.SAVED };
  } catch (error) {
    return { kind: readFailureKind(error, EveryPushKinds) };
  }
}
