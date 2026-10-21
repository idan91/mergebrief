// @vitest-environment jsdom
// Slot-bearing catalog keys rendered through <Trans>. Every slot here is
// self-closing, so a components array whose arity is short does not degrade to
// plain text: the element AND its content vanish. Typecheck cannot see it:
// `components` is never checked against the value.
//
// The `/` and `/settings` keys are MIRRORED here: neither route has a test
// harness, so these cases pin the catalog-plus-arity contract, not the call
// sites themselves. TokenSettings.test.tsx exercises its two keys for real.
import { render, screen } from "@testing-library/react";
import { I18nextProvider, Trans } from "react-i18next";
import { describe, expect, it } from "vitest";

import { appI18n } from "./I18nProvider";

const SIGN_IN = appI18n.t("shell.signInWithGithub");

function renderTrans(node: React.ReactNode) {
  render(<I18nextProvider i18n={appI18n}>{node}</I18nextProvider>);
}

describe("slot-bearing keys", () => {
  it("shell.signInPrompt keeps the sign-in link a link", () => {
    renderTrans(
      <Trans
        components={[
          <a href="/api/auth/github" key="signIn">
            {SIGN_IN}
          </a>,
        ]}
        i18nKey="shell.signInPrompt"
      />,
    );
    const link = screen.getByRole("link", { name: SIGN_IN });
    expect(link.getAttribute("href")).toBe("/api/auth/github");
    expect(document.body.textContent).toContain("to manage API tokens.");
  });
});
