import type { ValueOf } from "types/utils";
import type { AllowedHosts } from "./host-check";
import type { StaticFiles } from "./static-files";

/** How a shutdown ended: every request finished, or the budget cut the rest. */
export const DrainOutcomes = {
  DRAINED: "drained",
  FORCED: "forced",
} as const;
export type DrainOutcome = ValueOf<typeof DrainOutcomes>;

export interface WebServerConfig {
  readonly hostname: string;
  readonly port: number;
  readonly allowedHosts: AllowedHosts;
}

export interface WebServerOptions extends WebServerConfig {
  /** The built TanStack server entry's handler. */
  readonly fetch: (request: Request) => Response | Promise<Response>;
  /** The built client files, answered before the handler sees a request. */
  readonly staticFiles: StaticFiles;
  readonly logger: {
    error(msg: string, fields?: Record<string, unknown>): void;
  };
}
