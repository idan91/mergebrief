// @vitest-environment jsdom
import { SignInFailures } from "contract";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SignedOutHome } from "./index";

describe("SignedOutHome", () => {
  afterEach(cleanup);

  it("tells a refused account how an instance's owner gets in", () => {
    render(<SignedOutHome failure={SignInFailures.NOT_ALLOWED} />);

    expect(screen.getByRole("alert").textContent).toContain(
      "isn't allowed on this instance",
    );
    expect(screen.getByText(/under operators/)).toBeTruthy();
  });

  it("gives no setup line on any other failure", () => {
    render(<SignedOutHome failure={SignInFailures.SIGN_IN_FAILED} />);

    expect(screen.queryByText(/under operators/)).toBeNull();
  });
});
