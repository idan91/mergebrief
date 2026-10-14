// The outcome and the review body. The comments come off the session, and
// the commit off the named Brief's head; the request carries neither.
import { z } from "zod/v4";
import { RequestBounds } from "contract";
import { ReviewOutcomes } from "types/reviews";

export const submitBodySchema = z
  .object({
    outcome: z.enum(ReviewOutcomes),
    body: z.string().max(RequestBounds.BODY_LENGTH).optional(),
  })
  .refine(
    // GitHub documents `body` as REQUIRED for the REQUEST_CHANGES event;
    // reject deterministically here instead of surfacing GitHub's
    // unclassified 422 as a retry-looking 502.
    (submit) =>
      submit.outcome !== ReviewOutcomes.REQUEST_CHANGES ||
      (submit.body !== undefined && submit.body.trim() !== ""),
    { message: "a request-changes review needs a body" },
  );
