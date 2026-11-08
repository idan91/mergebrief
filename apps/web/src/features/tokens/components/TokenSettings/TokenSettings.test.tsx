// @vitest-environment jsdom
// Token settings behavior: the mint flow, the SHOWN-ONCE minted token (never re-renderable from any client state after
// dismissal), the deterministic-400 mirror, and revoke.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "sass";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appI18n } from "../../../../i18n/I18nProvider";

import type * as QueriesModule from "../../queries";

vi.mock("../../queries", async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return { ...actual, mintToken: vi.fn(), revokeToken: vi.fn() };
});

import { buildTokensQueryOptions, mintToken, revokeToken } from "../../queries";
import type { ApiTokenView, TokensView } from "../../types";
import { TokenSettings } from ".";

const mintMock = vi.mocked(mintToken);
const revokeMock = vi.mocked(revokeToken);

const LIVE_TOKEN: ApiTokenView = {
  id: "3",
  name: "ci-token",
  scope: "external-write",
  userLogin: "octocat",
  expiresAt: "2026-10-07T00:00:00.000Z",
  createdAt: "2026-07-09T12:00:00.000Z",
};

function renderSettings(tokens: TokensView = { tokens: [] }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(buildTokensQueryOptions().queryKey, tokens);
  render(
    <I18nextProvider i18n={appI18n}>
      <QueryClientProvider client={queryClient}>
        <TokenSettings enabled />
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return queryClient;
}

function readScopeDescription(): string {
  const ids = screen
    .getByLabelText(/scope/i)
    .getAttribute("aria-describedby")
    ?.split(" ");
  return (ids ?? [])
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const SECRET = "mergebrief_SHOWN_ONCE_SECRET";

describe("TokenSettings", () => {
  it("mirrors the deterministic 400: an empty name cannot submit", () => {
    renderSettings();
    const button = screen.getByRole("button", { name: /create token/i });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(button);
    expect(mintMock).not.toHaveBeenCalled();
  });

  it("will not mint until a scope is chosen, there is no default reach", () => {
    renderSettings();
    fireEvent.change(screen.getByLabelText(/token name/i), {
      target: { value: "ci-token" },
    });

    const button = screen.getByRole("button", { name: /create token/i });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText(/pick what the token is allowed to do/i)).not.toBe(
      null,
    );
    fireEvent.click(button);
    expect(mintMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/scope/i), {
      target: { value: "read" },
    });
    expect(
      screen
        .getByRole("button", { name: /create token/i })
        .getAttribute("aria-disabled"),
    ).not.toBe("true");
  });

  it("keeps the scope hint while the scope is chosen after the name", () => {
    renderSettings();
    const scopeHint = appI18n.t("tokens.scopeHint");
    const scopeRequired = appI18n.t("tokens.scopeRequired");
    const isCreateHeld = () =>
      screen
        .getByRole("button", { name: /create token/i })
        .getAttribute("aria-disabled") === "true";

    expect(readScopeDescription()).toBe(scopeHint);
    expect(screen.queryByText(scopeRequired)).toBe(null);
    expect(isCreateHeld()).toBe(true);

    fireEvent.change(screen.getByLabelText(/token name/i), {
      target: { value: "ci-token" },
    });
    expect(readScopeDescription()).toBe(`${scopeHint} ${scopeRequired}`);
    expect(screen.getByText(scopeHint)).toBeTruthy();
    expect(isCreateHeld()).toBe(true);

    fireEvent.change(screen.getByLabelText(/scope/i), {
      target: { value: "read" },
    });
    expect(readScopeDescription()).toBe(scopeHint);
    expect(screen.queryByText(scopeRequired)).toBe(null);
    expect(isCreateHeld()).toBe(false);
  });

  it("shows each token's scope in the list", () => {
    renderSettings({ tokens: [LIVE_TOKEN] });
    // The picker offers the same labels, so scope the query to the row.
    const row = screen.getByText("ci-token").parentElement;
    expect(row?.textContent).toMatch(/read, review, and post to github/i);
  });

  it("shows no scope label for a scope this bundle predates", () => {
    renderSettings({ tokens: [{ ...LIVE_TOKEN, scope: "unknown" }] });
    const row = screen.getByText("ci-token").parentElement;
    expect(row?.textContent).not.toMatch(/read only|in mergebrief|to github/i);
    expect(
      screen.getByRole("button", { name: /^revoke ci-token$/i }),
    ).toBeTruthy();
  });

  it("mints with the picked expiry and shows the token once", async () => {
    mintMock.mockResolvedValue({ token: SECRET, apiToken: LIVE_TOKEN });
    renderSettings();

    fireEvent.change(screen.getByLabelText(/token name/i), {
      target: { value: "ci-token" },
    });
    fireEvent.change(screen.getByLabelText(/expires/i), {
      target: { value: "none" },
    });
    fireEvent.change(screen.getByLabelText(/scope/i), {
      target: { value: "private-write" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create token/i }));

    await waitFor(() =>
      // react-query v5 passes its mutation context as a second argument.
      expect(mintMock).toHaveBeenCalledWith(
        {
          name: "ci-token",
          scope: "private-write",
          expiresInDays: null,
        },
        expect.anything(),
      ),
    );
    // Token material + the treat-as-password / CLI-plaintext disclaimer.
    const created = await screen.findByRole("group", { name: /shown once/i });
    expect(created.textContent).toContain(SECRET);
    expect(created.textContent).toMatch(/like a password/i);
    expect(created.textContent).toMatch(/plaintext/i);
    // The disclaimer's slots: a wrong components arity drops an element and
    // leaves its text bare, which no textContent assertion would notice.
    expect(
      [...created.querySelectorAll("code")].map((node) => node.textContent),
    ).toContain("chmod 600");
  });

  it("renders the intro's CLI name as code, not as bare text", () => {
    renderSettings();
    const intro = screen.getByText(/tokens let the/i);
    expect(intro.querySelector("code")?.textContent).toBe("mergebrief");
  });

  it("dismissal is final, the token cannot be shown again from any state", async () => {
    mintMock.mockResolvedValue({ token: SECRET, apiToken: LIVE_TOKEN });
    renderSettings();

    fireEvent.change(screen.getByLabelText(/token name/i), {
      target: { value: "ci-token" },
    });
    fireEvent.change(screen.getByLabelText(/scope/i), {
      target: { value: "read" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create token/i }));
    await screen.findByRole("status");

    fireEvent.click(screen.getByRole("button", { name: /^done$/i }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(document.body.textContent).not.toContain(SECRET);

    // Force a re-render pass; the material must not resurface from the
    // mutation cache or any retained state.
    fireEvent.change(screen.getByLabelText(/token name/i), {
      target: { value: "another" },
    });
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it("renders a catalog-backed create failure", async () => {
    mintMock.mockRejectedValue(new Error("provider detail"));
    renderSettings();

    fireEvent.change(screen.getByLabelText(/token name/i), {
      target: { value: "ci-token" },
    });
    fireEvent.change(screen.getByLabelText(/scope/i), {
      target: { value: "read" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create token/i }));

    const alert = await screen.findByText(
      "The token was not created. Try again.",
    );
    expect(alert.getAttribute("role")).toBe("alert");
  });

  it("lists tokens with their lifecycle and revokes in place", async () => {
    revokeMock.mockResolvedValue(undefined);
    renderSettings({ tokens: [LIVE_TOKEN] });

    expect(screen.getByText("ci-token")).toBeTruthy();
    expect(screen.getByText(/expires .*2026.*last used never/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^revoke ci-token$/i }));
    expect(revokeMock).not.toHaveBeenCalled();
    expect(document.activeElement?.textContent).toBe("Keep token");

    fireEvent.click(screen.getByRole("button", { name: /^revoke ci-token$/i }));
    await waitFor(() =>
      expect(revokeMock).toHaveBeenCalledWith("3", expect.anything()),
    );
  });

  it("keeps the token and returns focus when the confirm is dismissed", () => {
    renderSettings({ tokens: [LIVE_TOKEN] });

    fireEvent.click(screen.getByRole("button", { name: /^revoke ci-token$/i }));
    const warning = "Anything using it stops working.";
    const keep = screen.getByRole("button", {
      name: "Keep token",
      description: warning,
    });
    expect(document.activeElement).toBe(keep);
    expect(
      screen.getByRole("button", {
        name: /^revoke ci-token$/i,
        description: warning,
      }),
    ).toBeTruthy();

    fireEvent.keyDown(screen.getByRole("button", { name: "Keep token" }), {
      key: "Escape",
    });

    expect(revokeMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Keep token" })).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Revoke ci-token",
    );
  });

  it("keeps Copy the one primary while a created token is shown", async () => {
    mintMock.mockResolvedValue({ token: SECRET, apiToken: LIVE_TOKEN });
    renderSettings();
    const create = screen.getByRole("button", { name: /create token/i });
    expect(create.getAttribute("data-variant")).toBe("primary");

    fireEvent.change(screen.getByLabelText(/token name/i), {
      target: { value: "ci-token" },
    });
    fireEvent.change(screen.getByLabelText(/scope/i), {
      target: { value: "read" },
    });
    fireEvent.click(create);
    const copy = await screen.findByRole("button", { name: "Copy token" });
    fireEvent.change(screen.getByLabelText(/token name/i), {
      target: { value: "second" },
    });

    const primaries = document.querySelectorAll('[data-variant="primary"]');
    expect([...primaries]).toEqual([copy]);

    fireEvent.click(screen.getByRole("button", { name: /^done$/i }));
    expect(
      screen
        .getByRole("button", { name: /create token/i })
        .getAttribute("data-variant"),
    ).toBe("primary");
  });

  it("focuses Copy on creation and copies only when pressed", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    mintMock.mockResolvedValue({ token: SECRET, apiToken: LIVE_TOKEN });
    renderSettings();

    fireEvent.change(screen.getByLabelText(/token name/i), {
      target: { value: "ci-token" },
    });
    fireEvent.change(screen.getByLabelText(/scope/i), {
      target: { value: "read" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create token/i }));

    const copy = await screen.findByRole("button", { name: "Copy token" });
    expect(document.activeElement).toBe(copy);
    expect(writeText).not.toHaveBeenCalled();

    fireEvent.click(copy);
    await screen.findByRole("button", { name: "Token copied" });
    expect(writeText).toHaveBeenCalledWith(SECRET);
  });

  it("announces the copy result without the token in any live region", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    mintMock.mockResolvedValue({ token: SECRET, apiToken: LIVE_TOKEN });
    renderSettings();

    fireEvent.change(screen.getByLabelText(/token name/i), {
      target: { value: "ci-token" },
    });
    fireEvent.change(screen.getByLabelText(/scope/i), {
      target: { value: "read" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create token/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Copy token" }));
    await screen.findByRole("button", { name: "Token copied" });

    expect(screen.getByRole("status").textContent).toBe("Token copied");
    const live = document.querySelectorAll(
      '[role="status"], [role="alert"], [aria-live]',
    );
    for (const region of live) {
      expect(region.textContent).not.toContain(SECRET);
    }
  });

  it("starts a second token fresh, with focus back on Copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    mintMock.mockResolvedValueOnce({ token: SECRET, apiToken: LIVE_TOKEN });
    mintMock.mockResolvedValueOnce({
      token: "mergebrief_SECOND_SECRET",
      apiToken: { ...LIVE_TOKEN, id: "4" },
    });
    renderSettings();

    fireEvent.change(screen.getByLabelText(/token name/i), {
      target: { value: "ci-token" },
    });
    fireEvent.change(screen.getByLabelText(/scope/i), {
      target: { value: "read" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create token/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Copy token" }));
    await screen.findByRole("button", { name: "Token copied" });

    fireEvent.change(screen.getByLabelText(/token name/i), {
      target: { value: "second" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create token/i }));
    await screen.findByText("mergebrief_SECOND_SECRET");

    const copy = screen.getByRole("button", { name: "Copy token" });
    expect(document.activeElement).toBe(copy);
    expect(screen.getByRole("status").textContent).toBe("");
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

  it("moves focus to the row and announces when a revoke lands", async () => {
    const queryClient = renderSettings({ tokens: [LIVE_TOKEN] });
    revokeMock.mockImplementation(() => {
      queryClient.setQueryData(buildTokensQueryOptions().queryKey, {
        tokens: [{ ...LIVE_TOKEN, revokedAt: "2026-07-09T14:00:00.000Z" }],
      });
      return Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: /^revoke ci-token$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^revoke ci-token$/i }));

    const row = screen.getByRole("listitem");
    await waitFor(() => {
      expect(row.getAttribute("data-state")).toBe("revoked");
    });
    expect(document.activeElement).toBe(row);
    expect(screen.getByRole("status").textContent).toBe("ci-token revoked");
  });

  it("leaves focus alone when a row turns revoked from elsewhere", async () => {
    const queryClient = renderSettings({ tokens: [LIVE_TOKEN] });
    const name = screen.getByLabelText(/token name/i);
    name.focus();

    act(() => {
      queryClient.setQueryData(buildTokensQueryOptions().queryKey, {
        tokens: [{ ...LIVE_TOKEN, revokedAt: "2026-07-09T14:00:00.000Z" }],
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("listitem").getAttribute("data-state")).toBe(
        "revoked",
      );
    });
    expect(document.activeElement).toBe(name);
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("closes an open revoke confirm when the row turns revoked elsewhere", async () => {
    const queryClient = renderSettings({ tokens: [LIVE_TOKEN] });
    fireEvent.click(screen.getByRole("button", { name: "Revoke ci-token" }));
    expect(document.activeElement?.textContent).toBe("Keep token");

    act(() => {
      queryClient.setQueryData(buildTokensQueryOptions().queryKey, {
        tokens: [{ ...LIVE_TOKEN, revokedAt: "2026-07-09T14:00:00.000Z" }],
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("listitem").getAttribute("data-state")).toBe(
        "revoked",
      );
    });
    expect(screen.queryByRole("button", { name: "Keep token" })).toBeNull();
    expect(screen.queryByRole("button", { name: /revoke/i })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("listitem"));
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("stays silent when a failed revoke lands from elsewhere later", async () => {
    revokeMock.mockRejectedValue(new Error("provider detail"));
    const queryClient = renderSettings({ tokens: [LIVE_TOKEN] });
    fireEvent.click(screen.getByRole("button", { name: /^revoke ci-token$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^revoke ci-token$/i }));
    await screen.findByText(
      "Revoking failed and the token is still active. Try again.",
    );
    (document.activeElement as HTMLElement | null)?.blur();

    act(() => {
      queryClient.setQueryData(buildTokensQueryOptions().queryKey, {
        tokens: [{ ...LIVE_TOKEN, revokedAt: "2026-07-09T14:00:00.000Z" }],
      });
    });

    const row = screen.getByRole("listitem");
    await waitFor(() => {
      expect(row.getAttribute("data-state")).toBe("revoked");
    });
    expect(document.activeElement).not.toBe(row);
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("names each landed revoke in the one status line", async () => {
    const deployToken = { ...LIVE_TOKEN, id: "4", name: "deploy-token" };
    const queryClient = renderSettings({ tokens: [LIVE_TOKEN, deployToken] });
    revokeMock.mockImplementation((tokenId) => {
      const current = queryClient.getQueryData<TokensView>(
        buildTokensQueryOptions().queryKey,
      );
      queryClient.setQueryData(buildTokensQueryOptions().queryKey, {
        tokens: (current?.tokens ?? []).map((token) =>
          token.id === tokenId
            ? { ...token, revokedAt: "2026-07-09T14:00:00.000Z" }
            : token,
        ),
      });
      return Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: /^revoke ci-token$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^revoke ci-token$/i }));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("ci-token revoked");
    });
    fireEvent.click(
      screen.getByRole("button", { name: /^revoke deploy-token$/i }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /^revoke deploy-token$/i }),
    );

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(
        "deploy-token revoked",
      );
    });
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("holds another row's revoke while one is in flight", async () => {
    revokeMock.mockReturnValue(new Promise(() => undefined));
    renderSettings({
      tokens: [LIVE_TOKEN, { ...LIVE_TOKEN, id: "4", name: "deploy-token" }],
    });

    fireEvent.click(
      screen.getByRole("button", { name: /^revoke deploy-token$/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^revoke ci-token$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^revoke ci-token$/i }));
    await waitFor(() => expect(revokeMock).toHaveBeenCalledTimes(1));

    const heldRevoke = screen.getByRole("button", {
      name: /^revoke deploy-token$/i,
    });
    expect(heldRevoke.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(heldRevoke);

    expect(revokeMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Keep token" })).toBeTruthy();
  });

  it("renders a catalog-backed revoke failure", async () => {
    revokeMock.mockRejectedValue(new Error("provider detail"));
    renderSettings({ tokens: [LIVE_TOKEN] });

    fireEvent.click(screen.getByRole("button", { name: /^revoke ci-token$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^revoke ci-token$/i }));

    const alert = await screen.findByText(
      "Revoking failed and the token is still active. Try again.",
    );
    expect(alert.getAttribute("role")).toBe("alert");
  });
});

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const STYLES_DIRECTORY = join(TEST_DIRECTORY, "../../../../styles");
const NARROW_CONTAINER =
  /@container \(width < [^)]+\) \{((?:[^{}]*\{[^{}]*\})*)[^{}]*\}/;
const RULE = /([^{}]+)\{([^{}]*)\}/g;

/** Selectors that take the whole form row once the settings column is narrow. */
function readNarrowFullRowSelectors(): string[] {
  const { css } = compile(join(TEST_DIRECTORY, "TokenSettings.module.scss"), {
    loadPaths: [STYLES_DIRECTORY],
  });
  const narrowRules = NARROW_CONTAINER.exec(css)?.[1] ?? "";
  const selectors: string[] = [];
  for (const [, selector = "", body = ""] of narrowRules.matchAll(RULE)) {
    if (body.includes("grid-column: 1/-1")) {
      selectors.push(selector.trim());
    }
  }
  return selectors;
}

describe("TokenSettings narrow form", () => {
  it("gives the name and the scope a row each, so a scope label fits", () => {
    expect(readNarrowFullRowSelectors()).toEqual([".field:nth-child(-n+2)"]);
  });
});
