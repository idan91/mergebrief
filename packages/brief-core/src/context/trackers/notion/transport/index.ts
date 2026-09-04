import { createNotionHttpTransport } from "./http";

/** Every implementation of `NotionTransport`, one file each; a root binds one with `create()`. */
export const NotionTransports = {
  HTTP: { create: createNotionHttpTransport },
} as const;

export {
  createNotionHttpTransport,
  type NotionFetch,
  type NotionHttpTransportOptions,
} from "./http";
export {
  failRead,
  type NotionBlock,
  type NotionDataSource,
  type NotionPage,
  type NotionSession,
  type NotionTransport,
  type ReadResult,
} from "./port";
