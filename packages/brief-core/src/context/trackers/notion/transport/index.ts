import { createNotionHttpTransport } from "./http";

/** Every implementation of `NotionTransport`, one file each; a root binds one with `create()`. */
export const NotionTransports = {
  HTTP: { create: createNotionHttpTransport },
} as const;

export { type NotionHttpTransportOptions } from "./http";
export {
  type NotionBlock,
  type NotionDataSource,
  type NotionPage,
  type NotionSession,
  type NotionTransport,
} from "./port";
