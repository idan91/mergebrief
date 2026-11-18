const INTERNAL_ERROR_STATUS = 500;

export interface ErrorBody {
  readonly error: string;
}

export function answerJson(status: number, body: ErrorBody): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

export function answerInternalError(): Response {
  return answerJson(INTERNAL_ERROR_STATUS, { error: "internal error" });
}
