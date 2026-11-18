import type {
  TriggerOnDemandOutcome,
  TriggerOnDemandOutcomes,
} from "persistence";
import type { FreshRepositoryFailure } from "../../logic/fresh-repository";

/** A refusal from the store; each one wrote nothing. */
interface RegenerateRefusal {
  readonly kind: Exclude<
    TriggerOnDemandOutcome,
    typeof TriggerOnDemandOutcomes.QUEUED
  >;
}

/** The fresh read says the viewer cannot push, so nothing is queued. */
interface NoPushAccessFailure {
  readonly kind: "no-push-access";
}

/** Every regenerate answer but `queued`: a store refusal, lost push access, or GitHub refusing the live push read. */
export type RegenerateFailure =
  | RegenerateRefusal
  | NoPushAccessFailure
  | FreshRepositoryFailure;
