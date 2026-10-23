import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAnthropicClient } from "../src/adapters/anthropic";
import { stubCapturingFetch, type CapturingFetch } from "./helpers";

const AUTH_TOKEN_CANARY = "canary-auth-token";

function stubModelsFetch(): CapturingFetch {
  return stubCapturingFetch(
    () =>
      new Response(
        JSON.stringify({
          type: "model",
          id: "claude-test",
          display_name: "Claude Test",
          created_at: "2026-01-01T00:00:00Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );
}

describe("createAnthropicClient", () => {
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://redirect.invalid");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", AUTH_TOKEN_CANARY);
  });

  it("sends to the canonical host with the api key, ignoring ambient env", async () => {
    const capturing = stubModelsFetch();
    const client = createAnthropicClient({
      apiKey: "test-key",
      fetch: capturing.fetch,
    });

    await client.models.retrieve("claude-test");

    const [sent] = capturing.requests;
    expect(sent?.url).toBe("https://api.anthropic.com/v1/models/claude-test");
    expect(sent?.headers.get("x-api-key")).toBe("test-key");
    expect(sent?.headers.has("authorization")).toBe(false);
  });

  it("sends to the configured baseUrl when the Instance config sets one", async () => {
    const capturing = stubModelsFetch();
    const client = createAnthropicClient({
      apiKey: "test-key",
      baseUrl: "https://gateway.example",
      fetch: capturing.fetch,
    });

    await client.models.retrieve("claude-test");

    expect(capturing.requests[0]?.url).toBe(
      "https://gateway.example/v1/models/claude-test",
    );
  });
});
