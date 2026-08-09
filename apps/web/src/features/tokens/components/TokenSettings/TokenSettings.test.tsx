// @vitest-environment jsdom
// Token settings behavior: mint flow with the live installation picker, the
// SHOWN-ONCE minted token (never re-renderable from any client state after
// dismissal), the deterministic-400 mirror, and revoke.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type * as QueriesModule from "../../queries";

vi.mock("../../queries", async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return { ...actual, mintToken: vi.fn(), revokeToken: vi.fn() };
});

import { installationsQueryOptions } from "../../../installations/queries";
import type { InstallationsView } from "../../../installations/types";
import { mintToken, revokeToken, tokensQueryOptions } from "../../queries";
import type { ApiTokenView, TokensView } from "../../types";
import { TokenSettings } from "./TokenSettings";

const mintMock = vi.mocked(mintToken);
const revokeMock = vi.mocked(revokeToken);

const INSTALLATIONS: InstallationsView = {
  installations: [
    {
      installationId: "111",
      accountLogin: "acme",
      isCurrent: true,
      isDefault: false,
    },
    {
      installationId: "222",
      accountLogin: "globex",
      isCurrent: false,
      isDefault: false,
    },
  ],
  currentInstallationId: "111",
  defaultInstallationId: null,
};

const LIVE_TOKEN: ApiTokenView = {
  id: "3",
  name: "ci-token",
  installationId: "111",
  userLogin: "octocat",
  expiresAt: "2026-10-07T00:00:00.000Z",
  lastUsedAt: null,
  revokedAt: null,
  createdAt: "2026-07-09T12:00:00.000Z",
};

function renderSettings(tokens: TokensView = { tokens: [] }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(installationsQueryOptions().queryKey, INSTALLATIONS);
  queryClient.setQueryData(tokensQueryOptions().queryKey, tokens);
  render(
    <QueryClientProvider client={queryClient}>
      <TokenSettings enabled />
    </QueryClientProvider>,
  );
  return queryClient;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const SECRET = "mergebrief_SHOWN_ONCE_SECRET";

describe("TokenSettings", () => {
  it("mirrors the deterministic 400: an empty name cannot submit", () => {
    renderSettings();
    const button = screen.getByRole("button", { name: /mint token/i });
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(button);
    expect(mintMock).not.toHaveBeenCalled();
  });

  it("mints with the picked installation and expiry, then shows the token ONCE", async () => {
    mintMock.mockResolvedValue({ token: SECRET, apiToken: LIVE_TOKEN });
    renderSettings();

    fireEvent.change(screen.getByLabelText(/token name/i), {
      target: { value: "ci-token" },
    });
    fireEvent.change(screen.getByLabelText(/organization/i), {
      target: { value: "222" },
    });
    fireEvent.change(screen.getByLabelText(/expires/i), {
      target: { value: "none" },
    });
    fireEvent.click(screen.getByRole("button", { name: /mint token/i }));

    await waitFor(() =>
      // react-query v5 passes its mutation context as a second argument.
      expect(mintMock).toHaveBeenCalledWith(
        { name: "ci-token", installationId: "222", expiresInDays: null },
        expect.anything(),
      ),
    );
    // Token material + the treat-as-password / CLI-plaintext disclaimer.
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain(SECRET);
    expect(status.textContent).toMatch(/shown exactly once/i);
    expect(status.textContent).toMatch(/like a password/i);
    expect(status.textContent).toMatch(/plaintext/i);
  });

  it("dismissal is final — the token is not re-renderable from any state", async () => {
    mintMock.mockResolvedValue({ token: SECRET, apiToken: LIVE_TOKEN });
    renderSettings();

    fireEvent.change(screen.getByLabelText(/token name/i), {
      target: { value: "ci-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: /mint token/i }));
    await screen.findByRole("status");

    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(document.body.textContent).not.toContain(SECRET);

    // Force a re-render pass; the material must not resurface from the
    // mutation cache or any retained state.
    fireEvent.change(screen.getByLabelText(/token name/i), {
      target: { value: "another" },
    });
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it("lists tokens with their lifecycle and revokes in place", async () => {
    revokeMock.mockResolvedValue(undefined);
    renderSettings({ tokens: [LIVE_TOKEN] });

    expect(screen.getByText("ci-token")).toBeTruthy();
    expect(screen.getByText(/expires .*2026.*last used never/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^revoke ci-token$/i }));
    await waitFor(() =>
      expect(revokeMock).toHaveBeenCalledWith("3", expect.anything()),
    );
  });

  it("shows revoked rows without a revoke button", () => {
    renderSettings({
      tokens: [{ ...LIVE_TOKEN, revokedAt: "2026-07-09T14:00:00.000Z" }],
    });
    expect(screen.getByText(/revoked/i)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /^revoke ci-token$/i }),
    ).toBeNull();
  });
});
