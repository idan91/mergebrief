import { describe, expect, it } from "vitest";
import { fetchContextSnippets } from "../../src/context/fan-out";
import {
  ContextProviderTypes,
  ContextReadReasons,
  type ContextProvider,
  type ProviderSnippet,
} from "../../src/context/types";

function stubProvider(fetch: ContextProvider["fetch"]): ContextProvider {
  return { providerId: ContextProviderTypes.URL, fetch };
}

function makeSnippet(source: string): ProviderSnippet {
  return {
    providerId: ContextProviderTypes.URL,
    source,
    text: `body of ${source}`,
  };
}

const query = { title: "t", body: "see https://a.example/x" };

describe("fetchContextSnippets", () => {
  it("concatenates provider results in provider order and numbers them ctx-1..N", async () => {
    const slow = stubProvider(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return { ok: true, value: [makeSnippet("https://slow.example")] };
    });
    const fast = stubProvider(async () => ({
      ok: true,
      value: [
        makeSnippet("https://fast.example"),
        makeSnippet("https://fast.example/2"),
      ],
    }));

    const snippets = await fetchContextSnippets(query, [slow, fast]);

    expect(snippets.map((s) => [s.id, s.source])).toEqual([
      ["ctx-1", "https://slow.example"],
      ["ctx-2", "https://fast.example"],
      ["ctx-3", "https://fast.example/2"],
    ]);
  });

  it("fails open on a failed read, logging the reason and keeping the rest", async () => {
    const logs: string[] = [];
    const refused = stubProvider(async () => ({
      ok: false,
      error: { reason: ContextReadReasons.NO_CREDENTIAL, detail: "gh exit 4" },
    }));
    const fine = stubProvider(async () => ({
      ok: true,
      value: [makeSnippet("https://fine.example")],
    }));

    const snippets = await fetchContextSnippets(query, [refused, fine], (m) =>
      logs.push(m),
    );

    expect(snippets.map((s) => s.source)).toEqual(["https://fine.example"]);
    expect(
      logs.some((l) => l.includes("no-credential") && l.includes("gh exit 4")),
    ).toBe(true);
  });

  it("fails open when a provider throws", async () => {
    const logs: string[] = [];
    const broken = stubProvider(async () => {
      throw new Error("boom");
    });
    const fine = stubProvider(async () => ({
      ok: true,
      value: [makeSnippet("https://fine.example")],
    }));

    const snippets = await fetchContextSnippets(query, [broken, fine], (m) =>
      logs.push(m),
    );

    expect(snippets.map((s) => s.source)).toEqual(["https://fine.example"]);
    expect(logs.some((l) => l.includes("threw") && l.includes("boom"))).toBe(
      true,
    );
  });

  it("drops a provider that outlives its timeout, aborts its signal, and keeps the rest", async () => {
    const logs: string[] = [];
    let aborted = false;
    const hung = stubProvider(
      (_query, deps) =>
        new Promise(() => {
          deps.signal.addEventListener("abort", () => {
            aborted = true;
          });
        }),
    );
    const fine = stubProvider(async () => ({
      ok: true,
      value: [makeSnippet("https://fine.example")],
    }));

    const snippets = await fetchContextSnippets(
      query,
      [hung, fine],
      (m) => logs.push(m),
      { timeoutMs: 10, graceMs: 10 },
    );

    expect(snippets.map((s) => s.source)).toEqual(["https://fine.example"]);
    expect(aborted).toBe(true);
    expect(logs.some((l) => l.includes("timed out"))).toBe(true);
  });

  it("keeps what an aborted provider hands back within the grace", async () => {
    const trickling = stubProvider(
      (_query, deps) =>
        new Promise((resolve) => {
          deps.signal.addEventListener("abort", () =>
            resolve({ ok: true, value: [makeSnippet("https://done.example")] }),
          );
        }),
    );

    const snippets = await fetchContextSnippets(query, [trickling], () => {}, {
      timeoutMs: 10,
      graceMs: 200,
    });

    expect(snippets.map((s) => s.source)).toEqual(["https://done.example"]);
  });

  it("returns an empty list with no providers", async () => {
    expect(await fetchContextSnippets(query, [])).toEqual([]);
  });
});
