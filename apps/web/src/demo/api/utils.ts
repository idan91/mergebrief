import { ApiErrorStatusByCode, type ApiErrorCode } from "contract";
import { HttpStatuses } from "types";

import { JSON_CONTENT_TYPE, TEXT_CONTENT_TYPE } from "./consts";

export function answerJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: HttpStatuses.OK,
    headers: { "content-type": JSON_CONTENT_TYPE },
  });
}

/** A stored artifact body served verbatim, as the API serves its column. */
export function answerStoredJson(text: string): Response {
  return new Response(text, {
    status: HttpStatuses.OK,
    headers: { "content-type": JSON_CONTENT_TYPE },
  });
}

export function answerText(text: string): Response {
  return new Response(text, {
    status: HttpStatuses.OK,
    headers: { "content-type": TEXT_CONTENT_TYPE },
  });
}

export function answerEmpty(): Response {
  return new Response(null, { status: HttpStatuses.NO_CONTENT });
}

/** The wire error body with the status the contract pins to the code. */
export function answerRefusal(code: ApiErrorCode): Response {
  return new Response(JSON.stringify({ error: code, code }), {
    status: ApiErrorStatusByCode[code],
    headers: { "content-type": JSON_CONTENT_TYPE },
  });
}

/** Whether the query names exactly this span, whatever the key names are. */
export function matchesQuery(
  query: URLSearchParams,
  expected: Readonly<Record<string, string>>,
): boolean {
  return Object.entries(expected).every(
    ([key, value]) => query.get(key) === value,
  );
}
