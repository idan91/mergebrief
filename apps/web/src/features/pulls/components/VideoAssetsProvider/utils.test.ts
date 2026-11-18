import { describe, expect, it } from "vitest";

import {
  ATTACHMENT_ASSET_ID,
  requireAttachmentAssetId,
} from "@web/test/attachments";
import { readVideoAssetIdSet } from "./utils";

describe("readVideoAssetIdSet", () => {
  it("answers the ids as a set a line is looked up in", () => {
    const assetId = requireAttachmentAssetId(ATTACHMENT_ASSET_ID);

    const ids = readVideoAssetIdSet({ assetIds: [assetId, assetId] });

    expect([...ids]).toEqual([assetId]);
  });
});
