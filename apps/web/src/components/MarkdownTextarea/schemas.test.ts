import type { UploadAttachmentResponse } from "contract";
import type { Equals } from "types";
import { describe, expect, it } from "vitest";
import type { z } from "zod/v4";

import type { ReadsWireFields } from "@web/test/wire-fields";

import {
  parseUploadAttachmentResponse,
  type uploadAttachmentResponseSchema,
} from "./schemas";

const URL = "https://github.com/o/r/blob/mergebrief/attachments/a.png?raw=true";

describe("parseUploadAttachmentResponse", () => {
  it("reads the branch url", () => {
    expect(parseUploadAttachmentResponse({ url: URL })).toEqual({
      ok: true,
      value: { url: URL },
    });
  });

  it.each([[{}], [{ url: 7 }], [null], ["x"]])("refuses %j", (body) => {
    expect(parseUploadAttachmentResponse(body).ok).toBe(false);
  });
});

type ParsedUploadReceipt = z.output<typeof uploadAttachmentResponseSchema>;

const PINS = {
  matchesContract: true satisfies Equals<
    ParsedUploadReceipt,
    UploadAttachmentResponse
  >,
  readsWireFields: true satisfies ReadsWireFields<
    ParsedUploadReceipt,
    UploadAttachmentResponse
  >,
} as const;

describe("upload receipt parser matches the contract", () => {
  it.each(Object.entries(PINS))("%s is pinned", (_pin, pinned) => {
    expect(pinned).toBe(true);
  });
});
