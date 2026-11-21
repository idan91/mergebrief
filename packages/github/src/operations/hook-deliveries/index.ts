// The App's own webhook delivery log, on the App's JWT. GitHub keeps three days
// of it and never retries a failed delivery itself.
import type { Mutable, Result } from "types/utils";
import { z } from "zod/v4";
import type { AppClient } from "../../auth/app";
import {
  mapRequestError,
  unexpectedResponseError,
  type GitHubApiError,
} from "../../errors";

const PAGE_SIZE = 100;
const NEXT_CURSOR = /[?&]cursor=([^&>]+)[^>]*>;\s*rel="next"/;
const NUMERIC_ID_FIELD = /"id":\s*(\d+)/g;

const hookDeliveriesSchema = z.array(
  z.object({
    id: z.string().regex(/^\d+$/),
    guid: z.string().min(1),
    delivered_at: z.iso.datetime({ offset: true }),
    status_code: z.number().int().nonnegative(),
    event: z.string().min(1),
    action: z.string().nullable().optional(),
    redelivery: z.boolean(),
    installation_id: z.number().int().positive().nullable().optional(),
  }),
);

/** One attempt: a redelivery is its own row under the original's `guid`. */
export interface HookDelivery {
  /** Digits, never a number: GitHub's ids pass 2^53. */
  readonly id: string;
  readonly guid: string;
  readonly deliveredAt: Date;
  /** 0 when GitHub could not connect at all. */
  readonly statusCode: number;
  readonly event: string;
  readonly action?: string;
  /** False on the first attempt, whose row is what a redelivery names. */
  readonly redelivery: boolean;
  readonly installationId?: number;
}

function shapeHookDelivery(
  delivery: z.infer<typeof hookDeliveriesSchema>[number],
): HookDelivery {
  const shaped: Mutable<HookDelivery> = {
    id: delivery.id,
    guid: delivery.guid,
    deliveredAt: new Date(delivery.delivered_at),
    statusCode: delivery.status_code,
    event: delivery.event,
    redelivery: delivery.redelivery,
  };
  if (typeof delivery.action === "string") {
    shaped.action = delivery.action;
  }
  if (typeof delivery.installation_id === "number") {
    shaped.installationId = delivery.installation_id;
  }
  return shaped;
}

export interface HookDeliveryPage {
  readonly deliveries: readonly HookDelivery[];
  readonly nextCursor?: string;
}

/**
 * Quotes each id ahead of the parse, because a parsed id past 2^53 prints other
 * digits and would resend the wrong delivery. No string value can match: JSON
 * escapes the quotes inside one.
 */
async function parseDeliveriesBody(body: unknown): Promise<unknown> {
  if (!(body instanceof ReadableStream)) {
    return undefined;
  }
  const text = await new Response(body).text();
  const parsed: unknown = JSON.parse(
    text.replace(NUMERIC_ID_FIELD, '"id":"$1"'),
  );
  return parsed;
}

/** GitHub's delivery outcome filter: `failure` lists status codes 400 to 599 alone. */
const FAILURE_OUTCOME = "failure";

interface DeliveriesQuery {
  per_page: number;
  cursor?: string;
  status?: typeof FAILURE_OUTCOME;
  request: { parseSuccessResponseBody: boolean };
}

async function requestDeliveriesPage(
  app: AppClient,
  query: DeliveriesQuery,
): Promise<Result<HookDeliveryPage, GitHubApiError>> {
  try {
    const response = await app.octokit.request({
      method: "GET",
      url: "/app/hook/deliveries",
      ...query,
    });
    const parsed = hookDeliveriesSchema.safeParse(
      await parseDeliveriesBody(response.data),
    );
    if (!parsed.success) {
      return {
        ok: false,
        error: unexpectedResponseError("list hook deliveries"),
      };
    }

    const page: Mutable<HookDeliveryPage> = {
      deliveries: parsed.data.map(shapeHookDelivery),
    };
    const next = NEXT_CURSOR.exec(response.headers.link ?? "")?.[1];
    if (next !== undefined) {
      page.nextCursor = decodeURIComponent(next);
    }
    return { ok: true, value: page };
  } catch (error) {
    return { ok: false, error: mapRequestError(error, "list hook deliveries") };
  }
}

function makeDeliveriesQuery(cursor: string | undefined): DeliveriesQuery {
  const query: DeliveriesQuery = {
    per_page: PAGE_SIZE,
    request: { parseSuccessResponseBody: false },
  };
  if (cursor !== undefined) {
    query.cursor = cursor;
  }
  return query;
}

/** Every attempt, newest first. */
export async function listHookDeliveries(
  app: AppClient,
  cursor?: string,
): Promise<Result<HookDeliveryPage, GitHubApiError>> {
  return requestDeliveriesPage(app, makeDeliveriesQuery(cursor));
}

/**
 * The attempts GitHub classes as failed, newest first. An attempt that never
 * connected (status 0) is not among them.
 */
export async function listFailedHookDeliveries(
  app: AppClient,
  cursor?: string,
): Promise<Result<HookDeliveryPage, GitHubApiError>> {
  const query = makeDeliveriesQuery(cursor);
  query.status = FAILURE_OUTCOME;
  return requestDeliveriesPage(app, query);
}

/** GitHub answers 422 when it reads the attempts as spam. */
export async function redeliverHookDelivery(
  app: AppClient,
  deliveryId: string,
): Promise<Result<void, GitHubApiError>> {
  try {
    await app.octokit.request({
      method: "POST",
      url: "/app/hook/deliveries/{delivery_id}/attempts",
      delivery_id: deliveryId,
      request: { retries: 0 },
    });
    return { ok: true, value: undefined };
  } catch (error) {
    return {
      ok: false,
      error: mapRequestError(error, "redeliver hook delivery"),
    };
  }
}
