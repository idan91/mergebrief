// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { buildViewerQueryOptions } from "../queries";
import { ViewerStates, type ViewerState } from "../types";
import { useViewerLogin } from "./useViewerLogin";

export interface WrapperProps {
  children: ReactNode;
}

function renderWithViewer(viewer: ViewerState) {
  const client = new QueryClient();
  client.setQueryData(buildViewerQueryOptions().queryKey, viewer);
  function Wrapper({ children }: WrapperProps) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return renderHook(() => useViewerLogin(), { wrapper: Wrapper });
}

describe("useViewerLogin", () => {
  afterEach(cleanup);

  it("reads the signed-in viewer's login from the session", () => {
    const view = renderWithViewer({
      kind: ViewerStates.SIGNED_IN,
      login: "octocat",
      avatarUrl: "https://avatars.example/octocat.png",
      operator: false,
    });

    expect(view.result.current).toBe("octocat");
  });

  it("names no one when signed out", () => {
    const view = renderWithViewer({ kind: ViewerStates.SIGNED_OUT });

    expect(view.result.current).toBeUndefined();
  });
});
