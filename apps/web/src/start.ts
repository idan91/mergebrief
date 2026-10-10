import { createCsrfMiddleware, createStart } from "@tanstack/react-start";

import { apiErrorSerializationAdapter } from "./data/apiFetch";

// A start instance replaces Start's default request middleware, which is
// exactly this guard: server functions keep their same-origin check.
const csrfMiddleware = createCsrfMiddleware({
  filter: (context) => context.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware],
  serializationAdapters: [apiErrorSerializationAdapter],
}));
