// The demo build's server entry, used once at build time to render the SPA
// shell: Start's default handler alone, so no proxy, logger or env is loaded.
import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import type { ServerEntry } from "@tanstack/react-start/server-entry";

const serverEntry: ServerEntry = {
  fetch: createStartHandler(defaultStreamHandler),
};

export default serverEntry;
