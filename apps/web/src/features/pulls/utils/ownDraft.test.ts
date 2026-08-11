// The own-draft derivation truth table. The state is derived at READ time
// from two server-provided booleans — never stored, never self-declared. Both
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

  it("is false for the viewer's own ready (non-draft) PR", () => {
    expect(isOwnDraft({ draft: false, viewerIsAuthor: true })).toBe(false);
  });

  it("is false for an unrelated ready PR", () => {
    expect(isOwnDraft({ draft: false, viewerIsAuthor: false })).toBe(false);
  });
});

describe("draftPolicyNotice", () => {
  const ownDraft = { draft: true, viewerIsAuthor: true };

  it("is null for anyone but the draft's own author", () => {
    const policy = { generate: false, debounceSeconds: null };
    expect(
      draftPolicyNotice(t, policy, { draft: true, viewerIsAuthor: false }),
    ).toBeNull();
    expect(
      draftPolicyNotice(t, policy, { draft: false, viewerIsAuthor: true }),
    ).toBeNull();
  });

  it("is null when the policy is absent (list rows) or all-default", () => {
    expect(draftPolicyNotice(t, undefined, ownDraft)).toBeNull();
    expect(
      draftPolicyNotice(t, { generate: true, debounceSeconds: null }, ownDraft),
    ).toBeNull();
  });

  it("explains drafts-off, and off wins over damping", () => {
    for (const debounceSeconds of [null, 900]) {
      const notice = draftPolicyNotice(
        t,
        { generate: false, debounceSeconds },
        ownDraft,
      );
      expect(notice?.kind).toBe("drafts-off");
      expect(notice?.text).toContain("off on this instance");
      expect(notice?.text).toContain("marked ready");
    }
  });

  it("states the CONFIGURED damping window in minutes", () => {
    const notice = draftPolicyNotice(
      t,
      { generate: true, debounceSeconds: 900 },
      ownDraft,
    );
    expect(notice?.kind).toBe("damped");
    expect(notice?.text).toContain("15 minutes");
  });

  it("rounds sub-2-minute windows to 'about a minute'", () => {
    const notice = draftPolicyNotice(
      t,
      { generate: true, debounceSeconds: 90 },
      ownDraft,
    );
    expect(notice?.kind).toBe("damped");
    expect(notice?.text).toContain("about a minute");
  });
});
