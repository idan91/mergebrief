// The demo build's client entry: Start's default hydration with the API
// answered from the fixtures, installed before the router's first read.
import { StartClient } from "@tanstack/react-start/client";
import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";

import { createDemoFetch } from "./api";
import { DEMO_PR_PATH } from "./api/consts";

const ROOT_PATH = "/";

globalThis.fetch = createDemoFetch(globalThis.fetch);

// The demo opens on the brief; Home stays one click away through the header.
if (window.location.pathname === ROOT_PATH) {
  window.history.replaceState(window.history.state, "", DEMO_PR_PATH);
}

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <StartClient />
    </StrictMode>,
  );
});
