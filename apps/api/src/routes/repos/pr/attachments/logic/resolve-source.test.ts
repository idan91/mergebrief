import type { AttachmentAssetId } from "contract";
import { describe, expect, it } from "vitest";
import { resolveAttachmentSource } from "./resolve-source";

const ASSET_ID = "3e5dffc4-bd05-4a01-98e8-1c519ba4cf00" as AttachmentAssetId;
const SIGNED = `https://private-user-images.githubusercontent.com/1/2-${ASSET_ID}.png?jwt=abc`;
const PUBLIC = `https://github.com/user-attachments/assets/${ASSET_ID}`;

describe("resolveAttachmentSource", () => {
  it("picks the signed private image url carrying the asset id", () => {
    expect(
      resolveAttachmentSource(["https://x.test/a.png", SIGNED], ASSET_ID),
    ).toBe(SIGNED);
  });

  it("picks the bare asset url of a public repo", () => {
    expect(resolveAttachmentSource([PUBLIC], ASSET_ID)).toBe(PUBLIC);
  });

  it("picks the older per-repository asset url of a public repo", () => {
    const older = `https://github.com/acme/app/assets/12345/${ASSET_ID}`;

    expect(resolveAttachmentSource([older], ASSET_ID)).toBe(older);
  });

  it("ignores an older asset url for another id or with a query", () => {
    const base = "https://github.com/acme/app/assets/12345";

    expect(
      resolveAttachmentSource(
        [
          `${base}/96abe080-db23-4366-9eb8-32a76d148ae5`,
          `${base}/${ASSET_ID}?x=1`,
        ],
        ASSET_ID,
      ),
    ).toBeUndefined();
  });

  it("ignores a github url that only contains the id, listed first", () => {
    const planted = `https://github.com/attacker/pub/raw/main/${ASSET_ID}.png`;

    expect(resolveAttachmentSource([planted, SIGNED], ASSET_ID)).toBe(SIGNED);
  });

  it("ignores a signed host path that is not the asset shape", () => {
    expect(
      resolveAttachmentSource(
        [
          `https://private-user-images.githubusercontent.com/x/${ASSET_ID}`,
          `https://private-user-images.githubusercontent.com/1/2-${ASSET_ID}.svg`,
        ],
        ASSET_ID,
      ),
    ).toBeUndefined();
  });

  it("ignores the asset id on any other host", () => {
    expect(
      resolveAttachmentSource(
        [
          `https://camo.githubusercontent.com/x/${ASSET_ID}`,
          `https://evil.test/${ASSET_ID}`,
        ],
        ASSET_ID,
      ),
    ).toBeUndefined();
  });

  it("ignores an unparseable, http, port or credential bearing source", () => {
    expect(
      resolveAttachmentSource(
        [
          "not a url",
          `http://github.com/user-attachments/assets/${ASSET_ID}`,
          `https://github.com:8443/user-attachments/assets/${ASSET_ID}`,
          `https://u:p@github.com/user-attachments/assets/${ASSET_ID}`,
          `${PUBLIC}?x=1`,
        ],
        ASSET_ID,
      ),
    ).toBeUndefined();
  });

  it("answers undefined when the asset is not in the pull request", () => {
    expect(
      resolveAttachmentSource(
        [PUBLIC],
        "96abe080-db23-4366-9eb8-32a76d148ae5" as AttachmentAssetId,
      ),
    ).toBeUndefined();
  });
});
