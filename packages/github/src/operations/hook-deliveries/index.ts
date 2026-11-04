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

const hookDeliveriesSchema = z.array(
  z.object({
    id: z.number().int().positive(),
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
  readonly id: number;
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

export async function listHookDeliveries(
  app: AppClient,
  cursor?: string,
): Promise<Result<HookDeliveryPage, GitHubApiError>> {
  try {
    const parameters: { per_page: number; cursor?: string } = {
      per_page: PAGE_SIZE,
    };
    if (cursor !== undefined) {
      parameters.cursor = cursor;
    }
    const response = await app.octokit.request(
      "GET /app/hook/deliveries",
      parameters,
    );
    const parsed = hookDeliveriesSchema.safeParse(response.data);
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

/** GitHub answers 422 when it reads the attempts as spam. */
export async function redeliverHookDelivery(
  app: AppClient,
  deliveryId: number,
): Promise<Result<void, GitHubApiError>> {
  try {
    await app.octokit.request(
      "POST /app/hook/deliveries/{delivery_id}/attempts",
      { delivery_id: deliveryId, request: { retries: 0 } },
    );
    return { ok: true, value: undefined };
  } catch (error) {
    return {
      ok: false,
      error: mapRequestError(error, "redeliver hook delivery"),
    };
  }
}
