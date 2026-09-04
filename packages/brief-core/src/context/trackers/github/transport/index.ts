import { createGhTransport } from "./gh";
import { createInstallationTransport } from "./installation";

/** Every implementation of `GitHubTransport`, one file each; a root binds one with `create()`. */
export const GitHubTransports = {
  GH: { create: createGhTransport },
  INSTALLATION: { create: createInstallationTransport },
} as const;

export { createGhTransport, type GhExec } from "./gh";
export {
  createInstallationTransport,
  type InstallationBounds,
  type InstallationIssueApi,
} from "./installation";
export {
  readFailureForStatus,
  type GitHubTransport,
  type IssueLocator,
  type IssueRecord,
} from "./port";
