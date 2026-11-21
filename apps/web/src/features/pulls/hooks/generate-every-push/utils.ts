import type { TFunction } from "i18next";
import type { TranslationKey } from "i18n";

import { EveryPushResultKinds, type EveryPushResultKind } from "../../types";

type EveryPushFailureKind = Exclude<
  EveryPushResultKind,
  typeof EveryPushResultKinds.SAVED
>;

const EveryPushFailureNotices: Readonly<
  Record<EveryPushFailureKind, TranslationKey>
> = {
  [EveryPushResultKinds.NOT_ALLOWED]: "pulls.everyPush.notAllowed",
  [EveryPushResultKinds.UNAUTHORIZED]: "pulls.everyPush.unauthorized",
  [EveryPushResultKinds.UPSTREAM]: "pulls.everyPush.upstream",
  [EveryPushResultKinds.INDETERMINATE]: "pulls.everyPush.indeterminate",
};

/** The words one answer announces: a save names the state the switch landed in. */
export function readEveryPushNotice(
  t: TFunction,
  kind: EveryPushResultKind,
  requested: boolean,
): string {
  if (kind !== EveryPushResultKinds.SAVED) {
    return t(EveryPushFailureNotices[kind]);
  }
  if (requested) {
    return t("pulls.everyPush.turnedOn");
  }
  return t("pulls.everyPush.turnedOff");
}
