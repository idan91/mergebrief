import type { CliDeps } from "../types";

/** The server version each run observed, keyed by the run's deps: one entry
 * per `runCli`, the first response's header wins. */
const observedServerVersions = new WeakMap<CliDeps, string>();

export function recordServerVersion(deps: CliDeps, version: string): void {
  if (!observedServerVersions.has(deps)) {
    observedServerVersions.set(deps, version);
  }
}

export function readObservedServerVersion(deps: CliDeps): string | undefined {
  return observedServerVersions.get(deps);
}
