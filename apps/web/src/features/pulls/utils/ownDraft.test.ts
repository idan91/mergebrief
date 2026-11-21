// The own-draft derivation truth table. The state is derived at READ time
// from two server-provided booleans, never stored, never self-declared. Both
// must hold: someone else's draft and the viewer's own ready PR are both
// plain reviewer views.
import { describe, expect, it } from "vitest";
import { appI18n } from "../../../i18n/I18nProvider";
import { draftPolicyNotice, isOwnDraft } from "./ownDraft";

const t = appI18n.t;

describe("isOwnDraft", () => {
  it("is true only for the viewer's own draft", () => {
    expect(isOwnDraft({ draft: true, viewerIsAuthor: true })).toBe(true);
  });

  it("is false for someone else's draft", () => {
    expect(isOwnDraft({ draft: true, viewerIsAuthor: false })).toBe(false);
  });

  it("is false for the viewer's own ready PR", () => {
    expect(isOwnDraft({ draft: false, viewerIsAuthor: true })).toBe(false);
  });
});

describe("draftPolicyNotice", () => {
  const ownDraft = { draft: true, viewerIsAuthor: true };
  const damped = { debounceSeconds: 900 };

  it("is null for anyone but the draft's own author", () => {
    expect(
      draftPolicyNotice(t, damped, { draft: true, viewerIsAuthor: false }),
    ).toBeNull();
    expect(
      draftPolicyNotice(t, damped, { draft: false, viewerIsAuthor: true }),
    ).toBeNull();
  });

  it("is null when the policy is absent or all-default", () => {
    expect(draftPolicyNotice(t, undefined, ownDraft)).toBeNull();
    expect(draftPolicyNotice(t, {}, ownDraft)).toBeNull();
  });

  it("states the CONFIGURED damping window in minutes", () => {
    const notice = draftPolicyNotice(t, damped, ownDraft);
    expect(notice?.kind).toBe("damped");
    expect(notice?.text).toContain("15 minutes");
  });

  it("rounds sub-2-minute windows to 'about a minute'", () => {
    const notice = draftPolicyNotice(t, { debounceSeconds: 90 }, ownDraft);
    expect(notice?.kind).toBe("damped");
    expect(notice?.text).toContain("about a minute");
  });
});
