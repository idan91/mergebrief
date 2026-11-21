import type { FreshRepositoryFailure } from "../../logic/fresh-repository";

/** The row left the scope after the access step read it: absence, as before. */
interface EveryPushNotFound {
  readonly kind: "not-found";
}

/** The fresh read says the viewer cannot push, so nothing was written. */
interface NoPushAccessFailure {
  readonly kind: "no-push-access";
}

export type TurnOffEveryPushFailure = EveryPushNotFound;

/** Turning it on also rests on push access GitHub confirms at the click. */
export type TurnOnEveryPushFailure =
  | EveryPushNotFound
  | NoPushAccessFailure
  | FreshRepositoryFailure;
