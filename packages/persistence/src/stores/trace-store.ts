import { traceMethods } from "logging";
import { ScopeViolationError } from "./scope";

/** A row outside the caller's scope is the caller's answer, not a failed call. */
function isStoreFailure(error: unknown): boolean {
  return !(error instanceof ScopeViolationError);
}

/** Every store factory's spans: `<storeName>.<method>`, one per call. */
export function traceStore<Store extends object>(
  storeName: string,
  store: Store,
): Store {
  return traceMethods(storeName, store, { isFailure: isStoreFailure });
}
