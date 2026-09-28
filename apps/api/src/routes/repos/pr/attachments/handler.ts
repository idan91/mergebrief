import type { Context } from "hono";
import { isAttachmentAssetId } from "contract";
import { BadRequest, NotFound } from "../../../../shared-errors/api-error";
import { createReviewerGitHubClient } from "../../../auth/reviewer-github-client";
import type { AuthRouteDeps } from "../../../auth/session/types";
import { readFallbackTokenFor, type AuthzEnv } from "../../../authz";
import type { TtlCache } from "../../../ttl-cache";
import { prNumberSchema } from "../../../wire-bounds";
import { parseOwnerAndName } from "../../utils";
import { attachmentsController } from "./controller";
import { ATTACHMENT_RESPONSE_HEADERS } from "./consts";
import { throwReadAttachmentFailure } from "./logic/wire-failures";
import type {
  AttachmentsControllerDeps,
  AttachmentsHandlers,
  RenderedSources,
} from "./types";

const HEAD_METHOD = "HEAD";

export function createAttachmentsHandlers(
  deps: AuthRouteDeps,
  sourcesCache: TtlCache<RenderedSources>,
  sourcesInFlight: AttachmentsControllerDeps["sourcesInFlight"],
): AttachmentsHandlers {
  const readAttachment = async (c: Context<AuthzEnv>) => {
    const parsedPr = prNumberSchema.safeParse(c.req.param("prNumber"));
    if (!parsedPr.success) {
      throw new BadRequest();
    }
    // A malformed id is a 404, not a 400: the shape is not a hint to give.
    const assetId = c.req.param("assetId");
    if (assetId === undefined || !isAttachmentAssetId(assetId)) {
      throw new NotFound();
    }
    // The authz-verified full name, as the diff proxy reads it.
    const target = parseOwnerAndName(c.get("repoFullName"));
    if (target === undefined) {
      throw new NotFound();
    }

    const session = c.get("session");
    const github = createReviewerGitHubClient(
      deps,
      session,
      c.get("logger"),
      readFallbackTokenFor(c, deps),
    );
    const fetched = await attachmentsController.readAttachment(
      {
        github,
        fetchImpl: globalThis.fetch,
        sourcesCache,
        sourcesInFlight,
        repoId: String(c.get("repoId")),
      },
      {
        assetId,
        owner: target.owner,
        repo: target.repo,
        prNumber: parsedPr.data,
        sessionTokenHash: session.sessionTokenHash,
      },
    );
    if (!fetched.ok) {
      throwReadAttachmentFailure(fetched.error);
    }

    const headers = {
      ...ATTACHMENT_RESPONSE_HEADERS,
      "content-type": fetched.value.contentType,
    };
    // Hono answers HEAD by running this handler and dropping the body; the
    // upstream stream would otherwise stay open until it timed out.
    if (c.req.method === HEAD_METHOD) {
      await fetched.value.body.cancel();
      return c.body(null, 200, headers);
    }

    c.get("logger").debug("attachment proxied", { assetId });
    return c.body(fetched.value.body, 200, headers);
  };

  return { readAttachment };
}
