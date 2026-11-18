import { HttpStatuses } from "types";
import type { z } from "zod/v4";

import { parseWithSchema } from "@web/utils/parse-with-schema";

import {
  ApiError,
  ApiErrorCodes,
  apiFetch,
  errorFromResponse,
  type ApiFetchInit,
} from "../../apiFetch";

/** The 2xx response; a non-2xx throws its `ApiError`. */
export async function fetchOk(
  path: string,
  init: ApiFetchInit,
): Promise<Response> {
  const response = await apiFetch(path, init);
  if (!response.ok) {
    throw await errorFromResponse(response, path);
  }
  return response;
}

function buildMalformed(response: Response, path: string): ApiError {
  return new ApiError(ApiErrorCodes.MALFORMED, response.status, path);
}

/** A 2xx body as text; a 204 or an unreadable body is malformed. */
export async function readText(
  response: Response,
  path: string,
): Promise<string> {
  if (response.status === HttpStatuses.NO_CONTENT) {
    throw buildMalformed(response, path);
  }
  try {
    return await response.text();
  } catch {
    throw buildMalformed(response, path);
  }
}

function parseJson(text: string, response: Response, path: string): unknown {
  try {
    const body: unknown = JSON.parse(text);
    return body;
  } catch {
    throw buildMalformed(response, path);
  }
}

/** A 2xx body as unchecked JSON; a 204 or an empty body is `undefined`. */
export async function readJson(
  response: Response,
  path: string,
): Promise<unknown> {
  if (response.status === HttpStatuses.NO_CONTENT) {
    return undefined;
  }
  const text = await readText(response, path);
  if (text === "") {
    return undefined;
  }
  return parseJson(text, response, path);
}

export async function readParsed<Output>(
  response: Response,
  path: string,
  schema: z.ZodType<Output>,
): Promise<Output> {
  const text = await readText(response, path);
  const parsed = parseWithSchema(schema, parseJson(text, response, path));
  if (!parsed.ok) {
    throw buildMalformed(response, path);
  }
  return parsed.value;
}
