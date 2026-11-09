// @vitest-environment jsdom
import { SignInFailures } from "contract";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { appI18n } from "@web/i18n/I18nProvider";
import { Button } from "../Button";
import { SignInPage } from "./index";

function readSignIn() {
  return screen.getByRole("link", { name: /github/i });
}

describe("SignInPage", () => {
  afterEach(cleanup);

  it("names the brand mark by the product name", () => {
    render(<SignInPage heading="Sign in" />);

    expect(screen.getByRole("img", { name: "MergeBrief" })).toBeTruthy();
  });

  it("takes focus a swapped-out screen dropped to the body", () => {
    const { rerender } = render(<Button>Row</Button>);
    screen.getByRole("button", { name: "Row" }).focus();

    rerender(<SignInPage heading="Sign in" />);

    expect(document.activeElement).toBe(screen.getByRole("main"));
  });

  it("leaves focus on a control that stays mounted", () => {
    const menu = <Button>Menu</Button>;
    const { rerender } = render(menu);
    screen.getByRole("button", { name: "Menu" }).focus();

    rerender(
      <>
        {menu}
        <SignInPage heading="Sign in" />
      </>,
    );

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Menu" }),
    );
  });

  it("signs in to Home when no return path is given", () => {
    render(<SignInPage heading="Sign in" />);

    expect(readSignIn().getAttribute("href")).toBe("/api/auth/github");
  });

  it("returns to the page that asked for the sign-in", () => {
    render(<SignInPage heading="Sign in" returnTo="/settings" />);

    expect(readSignIn().getAttribute("href")).toBe(
      "/api/auth/github?returnTo=%2Fsettings",
    );
  });

  it("tells a refused account how an instance's owner gets in", () => {
    render(
      <SignInPage failure={SignInFailures.NOT_ALLOWED} heading="Sign in" />,
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "isn't allowed on this instance",
    );
    expect(screen.getByText(/add your GitHub id under/)).toBeTruthy();
  });

  it("sets the owner line's key, file and command as code", () => {
    render(
      <SignInPage failure={SignInFailures.NOT_ALLOWED} heading="Sign in" />,
    );

    const codes = [...document.querySelectorAll("code")].map(
      (code) => code.textContent,
    );
    expect(codes).toEqual([
      "operators",
      "mergebrief.config.yaml",
      "gh api users/YOUR_LOGIN --jq .id",
    ]);
  });

  it("leaves the owner line's identifiers to code, not the catalog", () => {
    const copy = appI18n.t("home.signedOut.accountNotAllowedOwner");

    expect(copy.match(/<\/?\d+\/?>/g)).toEqual(["<0/>", "<1/>", "<2/>"]);
  });

  it("gives no setup line on any other failure", () => {
    render(
      <SignInPage failure={SignInFailures.SIGN_IN_FAILED} heading="Sign in" />,
    );

    expect(screen.queryByText(/add your GitHub id under/)).toBeNull();
  });

  it("says GitHub could not be reached, with no setup line", () => {
    render(
      <SignInPage
        failure={SignInFailures.GITHUB_UNAVAILABLE}
        heading="Sign in"
      />,
    );

    expect(screen.getByRole("alert").textContent).toMatch(
      /GitHub couldn't be reached/,
    );
    expect(screen.queryByText(/add your GitHub id under/)).toBeNull();
  });

  it("marks the button busy once pressed and resets on a restored page", () => {
    render(<SignInPage heading="Sign in" />);

    fireEvent.click(readSignIn());
    expect(readSignIn().getAttribute("aria-busy")).toBe("true");
    expect(readSignIn().textContent).toBe("Opening GitHub…");

    act(() => {
      window.dispatchEvent(new Event("pageshow"));
    });
    expect(readSignIn().getAttribute("aria-busy")).toBeNull();
    expect(readSignIn().textContent).toBe("Sign in with GitHub");
  });

  it.each([
    ["Cmd", { metaKey: true }],
    ["Ctrl", { ctrlKey: true }],
    ["Shift", { shiftKey: true }],
    ["Alt", { altKey: true }],
  ])("stays ready after a %s-click opens elsewhere", (_key, modifier) => {
    render(<SignInPage heading="Sign in" />);

    fireEvent.click(readSignIn(), modifier);

    expect(readSignIn().getAttribute("aria-busy")).toBeNull();
    expect(readSignIn().textContent).toBe("Sign in with GitHub");
  });

  it("leaves the link followable while opening, for a stopped redirect", () => {
    render(<SignInPage heading="Sign in" />);

    fireEvent.click(readSignIn());
    const second = fireEvent.click(readSignIn());

    expect(second).toBe(true);
  });
});
