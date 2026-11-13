import { createJiraHttpTransport } from "./http";

/** Every implementation of `JiraTransport`, one file each; a root binds one with `create()`. */
export const JiraTransports = {
  HTTP: { create: createJiraHttpTransport },
} as const;

export {
  JiraCloudIdFailureReasons,
  JiraScopeChecks,
  type JiraSession,
  type JiraTransport,
} from "./port";
