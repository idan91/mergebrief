import { describe, expect, it } from "vitest";
import { resolveExportTokens } from "../../src/logic/export/tokens";

const TOKEN = "ghs_sekrit";
const DRY_RUN = { pushes: false, authenticatesReads: false };
const PUBLISH = { pushes: true, authenticatesReads: false };

describe("where the publish token goes", () => {
  it("gives a dry run no token, whatever the environment holds", () => {
    const tokens = resolveExportTokens(TOKEN, DRY_RUN);

    expect(tokens).toEqual({ ok: true, value: {} });
  });

  it("gives a publish the token for its pushes and never for its reads", () => {
    const tokens = resolveExportTokens(TOKEN, PUBLISH);

    expect(tokens).toEqual({ ok: true, value: { publish: TOKEN } });
  });

  it("gives a dry run with authenticated reads the token for reads only", () => {
    const use = { ...DRY_RUN, authenticatesReads: true };

    const tokens = resolveExportTokens(TOKEN, use);

    expect(tokens).toEqual({ ok: true, value: { publicRead: TOKEN } });
  });

  it("gives a publish with authenticated reads the token for both", () => {
    const use = { ...PUBLISH, authenticatesReads: true };

    const tokens = resolveExportTokens(TOKEN, use);

    const both = { publish: TOKEN, publicRead: TOKEN };
    expect(tokens).toEqual({ ok: true, value: both });
  });

  it("needs no token for a dry run that reads anonymously", () => {
    expect(resolveExportTokens(undefined, DRY_RUN)).toEqual({
      ok: true,
      value: {},
    });
  });

  it.each([undefined, ""])(
    "refuses a use that needs a missing token",
    (token) => {
      const reads = { ...DRY_RUN, authenticatesReads: true };

      expect(resolveExportTokens(token, PUBLISH).ok).toBe(false);
      expect(resolveExportTokens(token, reads).ok).toBe(false);
    },
  );
});
