import { readFileSync } from "node:fs";
import { JiraTransports } from "../../../../../../src/context/trackers/jira";
import type {
  JiraSession,
  JiraTransport,
} from "../../../../../../src/context/trackers/jira/transport";
import type { JiraFetch } from "../../../../../../src/context/trackers/jira/transport/http";

export const CLOUD_ID = "11111111-2222-4333-8444-555555555555";
/** The second cloud id form Atlassian gives: a UUID with a suffix. */
export const ECOSYSTEM_CLOUD_ID =
  "fff89a1a-52c8-11e5-91b2-3c15c2bd8caa-ecosystem";
export const SITE = "acme.atlassian.net";
export const TENANT_INFO_URL = "https://acme.atlassian.net/_edge/tenant_info";
export const TENANT_INFO_ANSWER: RecordedAnswer = {
  status: 200,
  body: JSON.stringify({ cloudId: CLOUD_ID }),
};
export const EMAIL = "reader@example.invalid";
export const TOKEN = "atl-token-never-shown";
/** base64 of `reader@example.invalid:atl-token-never-shown`, encoded outside the code under test. */
export const BASIC_CREDENTIAL =
  "cmVhZGVyQGV4YW1wbGUuaW52YWxpZDphdGwtdG9rZW4tbmV2ZXItc2hvd24=";
const FAILURE_CATEGORY_HEADER = "x-failure-category";
const STREAM_CHUNK_BYTES = 64 * 1024;

export interface RecordedAnswer {
  readonly status: number;
  readonly body?: string | ReadableStream<Uint8Array>;
  readonly failureCategory?: string;
}

export interface FetchCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly redirect: string;
}

/** What one side of a stubbed site answers: a recorded answer, or a fetch that decides. */
export type AnswerSource = RecordedAnswer | JiraFetch;

export interface StubbedFetch {
  readonly fetch: JiraFetch;
  readonly calls: FetchCall[];
}

export interface EndlessBody {
  readonly body: ReadableStream<Uint8Array>;
  wasCancelled(): boolean;
}

function makeAnsweringFetch(answer: RecordedAnswer): JiraFetch {
  return async () => {
    const headers = new Headers();
    if (answer.failureCategory !== undefined) {
      headers.set(FAILURE_CATEGORY_HEADER, answer.failureCategory);
    }
    return new Response(answer.body ?? null, {
      status: answer.status,
      headers,
    });
  };
}

function resolveFetch(source: AnswerSource): JiraFetch {
  if (typeof source === "function") {
    return source;
  }
  return makeAnsweringFetch(source);
}

/** Keeps every call, then hands it to `fetch`. */
function recordFetch(fetch: JiraFetch): StubbedFetch {
  const calls: FetchCall[] = [];
  const recorded: JiraFetch = (url, init) => {
    calls.push({
      url,
      method: init.method,
      headers: init.headers,
      redirect: init.redirect,
    });
    return fetch(url, init);
  };
  return { fetch: recorded, calls };
}

/** A recorded Jira: every call gets the same answer, and every call is kept. */
export function stubFetch(answer: RecordedAnswer): StubbedFetch {
  return recordFetch(makeAnsweringFetch(answer));
}

/** A recorded Jira site: its tenant info answers `tenantInfo`, the API `api`, and every call is kept. */
export function stubSiteFetch(
  api: AnswerSource,
  tenantInfo: AnswerSource = TENANT_INFO_ANSWER,
): StubbedFetch {
  const apiFetch = resolveFetch(api);
  const tenantInfoFetch = resolveFetch(tenantInfo);
  return recordFetch((url, init) => {
    if (url === TENANT_INFO_URL) {
      return tenantInfoFetch(url, init);
    }
    return apiFetch(url, init);
  });
}

/** A fetch that never answers and rejects once its signal aborts, as the platform's does. */
export function stubStalledFetch(): JiraFetch {
  return (_url, init) =>
    new Promise((_, reject) => {
      const abort = () => reject(new DOMException("aborted", "AbortError"));
      if (init.signal.aborted) {
        abort();
        return;
      }
      init.signal.addEventListener("abort", abort);
    });
}

/** A fetch whose connection fails before any answer. */
export function stubUnreachableFetch(): JiraFetch {
  return () => Promise.reject(new TypeError("fetch failed"));
}

/** A body that never ends; `wasCancelled` turns true once the reader gives up on it. */
export function makeEndlessBody(): EndlessBody {
  let cancelled = false;
  const chunk = new Uint8Array(STREAM_CHUNK_BYTES).fill(0x20);
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    },
  });
  return { body, wasCancelled: () => cancelled };
}

export function readFixture(name: string): string {
  return readFileSync(
    new URL(`../../fixtures/${name}`, import.meta.url),
    "utf8",
  );
}

export function makeSession(
  signal: AbortSignal = new AbortController().signal,
  site = SITE,
): JiraSession {
  return { site, email: EMAIL, token: TOKEN, signal };
}

export function makeTransport(
  fetch: JiraFetch,
  timeoutMs?: number,
): JiraTransport {
  return JiraTransports.HTTP.create({ fetch, timeoutMs });
}
