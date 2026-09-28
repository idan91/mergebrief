import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_ASSET_ORIGIN,
  ATTACHMENT_ASSET_PATH_PREFIX,
  AttachmentParseErrorCodes,
  parseAttachmentAssetId,
} from "../src/index";

const ASSET_ID = "3e5dffc4-bd05-4a01-98e8-1c519ba4cf00";
const ASSET_URL = `${ATTACHMENT_ASSET_ORIGIN}${ATTACHMENT_ASSET_PATH_PREFIX}${ASSET_ID}`;

describe("parseAttachmentAssetId", () => {
  it("accepts a github user-attachments asset url", () => {
    const parsed = parseAttachmentAssetId(ASSET_URL);

    expect(parsed).toEqual({ ok: true, value: ASSET_ID });
  });

  it("rejects a url on another host", () => {
    const parsed = parseAttachmentAssetId(
      `https://example.com/user-attachments/assets/${ASSET_ID}`,
    );

    expect(parsed).toEqual({
      ok: false,
      error: AttachmentParseErrorCodes.NOT_AN_ATTACHMENT,
    });
  });

  it("rejects http", () => {
    const parsed = parseAttachmentAssetId(
      `http://github.com/user-attachments/assets/${ASSET_ID}`,
    );

    expect(parsed.ok).toBe(false);
  });

  it("rejects a path suffix after the id", () => {
    const parsed = parseAttachmentAssetId(`${ASSET_URL}/extra`);

    expect(parsed.ok).toBe(false);
  });

  it("rejects an upper-case or malformed id", () => {
    expect(
      parseAttachmentAssetId(
        `${ATTACHMENT_ASSET_ORIGIN}${ATTACHMENT_ASSET_PATH_PREFIX}${ASSET_ID.toUpperCase()}`,
      ).ok,
    ).toBe(false);
    expect(
      parseAttachmentAssetId(
        `${ATTACHMENT_ASSET_ORIGIN}${ATTACHMENT_ASSET_PATH_PREFIX}not-a-uuid`,
      ).ok,
    ).toBe(false);
  });

  it("rejects a query or hash on the url", () => {
    expect(parseAttachmentAssetId(`${ASSET_URL}?x=1`).ok).toBe(false);
    expect(parseAttachmentAssetId(`${ASSET_URL}#frag`).ok).toBe(false);
  });

  it("rejects an unparseable url", () => {
    expect(parseAttachmentAssetId("not a url").ok).toBe(false);
  });
});
