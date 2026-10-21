import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_ASSET_ORIGIN,
  ATTACHMENT_ASSET_PATH_PREFIX,
  ATTACHMENT_BRANCH,
  AttachmentMediaTypes,
  AttachmentParseErrorCodes,
  AttachmentSourceKinds,
  buildAttachmentBranchUrl,
  parseAttachmentAssetId,
  parseAttachmentFileName,
  parseAttachmentSource,
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

describe("parseAttachmentSource", () => {
  const BRANCH_URL = `https://github.com/acme/app/blob/mergebrief/attachments/${ASSET_ID}.png?raw=true`;

  it("reads a user-attachments url as the asset shape", () => {
    expect(parseAttachmentSource(ASSET_URL)).toEqual({
      ok: true,
      value: { kind: AttachmentSourceKinds.ASSET, assetId: ASSET_ID },
    });
  });

  it("reads a branch-hosted url as the branch shape with its file", () => {
    expect(parseAttachmentSource(BRANCH_URL)).toEqual({
      ok: true,
      value: {
        kind: AttachmentSourceKinds.BRANCH,
        assetId: ASSET_ID,
        owner: "acme",
        repo: "app",
        fileName: `${ASSET_ID}.png`,
        mediaType: AttachmentMediaTypes.PNG,
      },
    });
  });

  it("reads an enterprise-managed owner with its underscore", () => {
    const url = `https://github.com/jdoe_acme/app/blob/mergebrief/attachments/${ASSET_ID}.png?raw=true`;
    const parsed = parseAttachmentSource(url);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.value.kind).toBe("branch");
  });

  it("rejects a file on another branch or at another depth", () => {
    expect(
      parseAttachmentSource(
        `https://github.com/acme/app/blob/main/${ASSET_ID}.png?raw=true`,
      ).ok,
    ).toBe(false);
    expect(
      parseAttachmentSource(
        `https://github.com/acme/app/blob/mergebrief/attachments/nested/${ASSET_ID}.png?raw=true`,
      ).ok,
    ).toBe(false);
    expect(
      parseAttachmentSource(
        `https://github.com/acme/app/raw/mergebrief/attachments/${ASSET_ID}.png?raw=true`,
      ).ok,
    ).toBe(false);
  });

  it("rejects a branch url without exactly the raw query", () => {
    expect(
      parseAttachmentSource(
        `https://github.com/acme/app/blob/mergebrief/attachments/${ASSET_ID}.png`,
      ).ok,
    ).toBe(false);
    expect(parseAttachmentSource(`${BRANCH_URL}&x=1`).ok).toBe(false);
    expect(parseAttachmentSource(`${BRANCH_URL}#frag`).ok).toBe(false);
  });

  it("rejects an extension outside the image allowlist", () => {
    expect(
      parseAttachmentSource(
        `https://github.com/acme/app/blob/mergebrief/attachments/${ASSET_ID}.svg?raw=true`,
      ).ok,
    ).toBe(false);
    expect(
      parseAttachmentSource(
        `https://github.com/acme/app/blob/mergebrief/attachments/${ASSET_ID}?raw=true`,
      ).ok,
    ).toBe(false);
  });

  it("rejects http, a port, credentials or a malformed id", () => {
    expect(
      parseAttachmentSource(
        `http://github.com/acme/app/blob/mergebrief/attachments/${ASSET_ID}.png?raw=true`,
      ).ok,
    ).toBe(false);
    expect(
      parseAttachmentSource(
        `https://github.com:8443/acme/app/blob/mergebrief/attachments/${ASSET_ID}.png?raw=true`,
      ).ok,
    ).toBe(false);
    expect(
      parseAttachmentSource(
        `https://u:p@github.com/acme/app/blob/mergebrief/attachments/${ASSET_ID}.png?raw=true`,
      ).ok,
    ).toBe(false);
    expect(
      parseAttachmentSource(
        `https://github.com/acme/app/blob/mergebrief/attachments/${ASSET_ID.toUpperCase()}.png?raw=true`,
      ).ok,
    ).toBe(false);
  });
});

describe("parseAttachmentFileName", () => {
  it("reads an allowlisted image file name into its id and type", () => {
    expect(parseAttachmentFileName(`${ASSET_ID}.webp`)).toEqual({
      ok: true,
      value: {
        assetId: ASSET_ID,
        fileName: `${ASSET_ID}.webp`,
        mediaType: AttachmentMediaTypes.WEBP,
      },
    });
  });

  it("rejects a bare id, another extension or a foreign stem", () => {
    expect(parseAttachmentFileName(ASSET_ID).ok).toBe(false);
    expect(parseAttachmentFileName(`${ASSET_ID}.svg`).ok).toBe(false);
    expect(parseAttachmentFileName(`${ASSET_ID}.PNG`).ok).toBe(false);
    expect(parseAttachmentFileName("shot.png").ok).toBe(false);
    expect(parseAttachmentFileName(`../${ASSET_ID}.png`).ok).toBe(false);
  });
});

describe("buildAttachmentBranchUrl", () => {
  it("writes the blob url with the raw query the renderer reads back", () => {
    const url = buildAttachmentBranchUrl({
      owner: "acme",
      repo: "app",
      fileName: `${ASSET_ID}.png`,
    });

    expect(url).toBe(
      `https://github.com/acme/app/blob/${ATTACHMENT_BRANCH}/${ASSET_ID}.png?raw=true`,
    );
    expect(parseAttachmentAssetId(url)).toEqual({ ok: true, value: ASSET_ID });
  });
});
