// The demo's data layer: a `fetch` that answers `/api/*` from the bundled
// fixtures and hands everything else to the real one. The production code
// above it (`data/apiFetch`, `data/request`, the readers) runs unchanged.
import { HttpMethods } from "types";

import { answerDemoRequest } from "./answers";
import { API_PATH_PREFIX, DEMO_URL_BASE } from "./consts";
import { createDemoSessionStore } from "./session";

function readRequestUrl(input: RequestInfo | URL): URL {
  if (input instanceof URL) {
    return input;
  }
  if (typeof input === "string") {
    return new URL(input, DEMO_URL_BASE);
  }
  return new URL(input.url, DEMO_URL_BASE);
}

function readRequestMethod(
  input: RequestInfo | URL,
  init?: RequestInit,
): string {
  if (init?.method !== undefined) {
    return init.method.toUpperCase();
  }
  if (input instanceof Request) {
    return input.method.toUpperCase();
  }
  return HttpMethods.GET;
}

/** The JSON a request sends, or undefined when it sends none or none that parses. */
async function readRequestBody(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<unknown> {
  const raw = await readRequestText(input, init);
  if (raw === undefined || raw === "") {
    return undefined;
  }
  try {
    const body: unknown = JSON.parse(raw);
    return body;
  } catch {
    return undefined;
  }
}

async function readRequestText(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<string | undefined> {
  if (typeof init?.body === "string") {
    return init.body;
  }
  if (input instanceof Request) {
    return input.text();
  }
  return undefined;
}

/** The browser's `fetch` with the API answered from the fixtures and one in-tab review session. */
export function createDemoFetch(passThrough: typeof fetch): typeof fetch {
  const store = createDemoSessionStore();
  return async (input, init) => {
    const url = readRequestUrl(input);
    if (!url.pathname.startsWith(API_PATH_PREFIX)) {
      return passThrough(input, init);
    }
    const method = readRequestMethod(input, init);
    const body = await readRequestBody(input, init);
    return answerDemoRequest({ method, url, body }, store);
  };
}
