import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod/v4";
import type Anthropic from "@anthropic-ai/sdk";
import { AnthropicGenerator } from "../src/adapters/anthropic";

/**
 * Exercises the parse-failure path of AnthropicGenerator (salvage → feedback
 * retry → dump-and-throw) against a stubbed SDK client.
 *
 * DELIBERATE ASYMMETRY: this stays a stub-level SDK-client fake while the
 * API adapters fake at fetch level — it is the characterization anchor, so
 * do not rewrite it alongside implementation changes. Promote to a
 * wire-level fake if a bug escapes through the stubbed surface, or on the
 * next substantive SDK-client change.
 */

const Schema = z.object({
  title: z.string(),
  tags: z.array(z.enum(["bugfix", "new-feature"])),
});

interface FakeTurn {
  /** Raw text the "model" produced this turn. */
  raw: string;
  /** When set, `finalMessage()` rejects with this instead of resolving. */
  rejectWith?: unknown;
}

function fakeClient(turns: FakeTurn[]) {
  const requests: { messages: { role: string; content: unknown }[] }[] = [];
  const streamOptions: (undefined | { signal?: AbortSignal })[] = [];
  const client = {
    messages: {
      stream(
        params: { messages: { role: string; content: unknown }[] },
        options?: { signal?: AbortSignal },
      ) {
        requests.push(params);
        streamOptions.push(options);
        const turn = turns[requests.length - 1];
        if (!turn) throw new Error("fakeClient: no scripted turn left");
        const response = {
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
          content: [{ type: "text", text: turn.raw }],
          get parsed_output() {
            const parsed = Schema.safeParse(JSON.parse(turn.raw));
            if (!parsed.success) {
              throw new Error(
                `Failed to parse structured output: ${parsed.error.message}`,
              );
            }
            return parsed.data;
          },
        };
        return {
          on() {},
          async finalMessage() {
            if (turn.rejectWith !== undefined) throw turn.rejectWith;
            return response;
          },
        };
      },
    },
  };
  return { client: client as unknown as Anthropic, requests, streamOptions };
}

function generateWith(turns: FakeTurn[], failureDir: string) {
  const { client, requests } = fakeClient(turns);
  const generator = new AnthropicGenerator(client, failureDir);
  const result = generator.generate({
    schema: Schema,
    system: "sys",
    user: "usr",
    effort: "medium",
    label: "brief",
    salvageFields: ["tags"],
  });
  return { result, requests };
}

describe("AnthropicGenerator parse-failure handling", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "generator-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns valid output untouched", async () => {
    const { result } = generateWith(
      [{ raw: JSON.stringify({ title: "t", tags: ["bugfix"] }) }],
      dir,
    );
    await expect(result).resolves.toEqual({ title: "t", tags: ["bugfix"] });
  });

  it("salvages a droppable enum slip without a second request", async () => {
    const { result, requests } = generateWith(
      [{ raw: JSON.stringify({ title: "t", tags: ["bugfix", "scary"] }) }],
      dir,
    );
    await expect(result).resolves.toEqual({ title: "t", tags: ["bugfix"] });
    expect(requests).toHaveLength(1);
  });

  it("retries once with error feedback on an unsalvageable failure", async () => {
    const bad = JSON.stringify({ title: 42, tags: [] });
    const good = JSON.stringify({ title: "fixed", tags: [] });
    const { result, requests } = generateWith(
      [{ raw: bad }, { raw: good }],
      dir,
    );
    await expect(result).resolves.toEqual({ title: "fixed", tags: [] });
    expect(requests).toHaveLength(2);
    // The retry carries the failed output and the validation error as feedback.
    const retryMessages = requests[1]?.messages;
    if (!retryMessages) throw new Error("expected a retry request");
    expect(retryMessages).toHaveLength(3);
    expect(retryMessages[1]).toMatchObject({ role: "assistant", content: bad });
    expect(String(retryMessages[2]?.content)).toContain(
      "failed schema validation",
    );
  });

  it("throws after the retry also fails, with the raw output dumped", async () => {
    const bad = JSON.stringify({ title: 42, tags: [] });
    const { result } = generateWith([{ raw: bad }, { raw: bad }], dir);
    await expect(result).rejects.toThrow(/raw output saved to/);
    const dumps = readdirSync(dir).filter((f) => f.endsWith(".failed.json"));
    expect(dumps.length).toBe(2);
    const firstDump = dumps[0];
    if (!firstDump) throw new Error("expected a dump file");
    const dumped = JSON.parse(readFileSync(join(dir, firstDump), "utf8"));
    expect(dumped.raw).toBe(bad);
    expect(dumped.error).toContain("Failed to parse structured output");
  });
});

describe("AnthropicGenerator cooperative cancellation", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "generator-abort-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("threads the request signal into the SDK stream options", async () => {
    const { client, streamOptions } = fakeClient([
      { raw: JSON.stringify({ title: "t", tags: ["bugfix"] }) },
    ]);
    const controller = new AbortController();
    const generator = new AnthropicGenerator(client, dir);
    await generator.generate({
      schema: Schema,
      system: "sys",
      user: "usr",
      effort: "medium",
      label: "brief",
      signal: controller.signal,
    });
    expect(streamOptions[0]?.signal).toBe(controller.signal);
  });

  it("propagates an abort rejection untouched: no feedback retry, no failure dump", async () => {
    const abortError = Object.assign(new Error("Request was aborted."), {
      name: "APIUserAbortError",
    });
    const { client, requests } = fakeClient([
      { raw: "", rejectWith: abortError },
    ]);
    const controller = new AbortController();
    const generator = new AnthropicGenerator(client, dir);
    await expect(
      generator.generate({
        schema: Schema,
        system: "sys",
        user: "usr",
        effort: "medium",
        label: "brief",
        signal: controller.signal,
      }),
    ).rejects.toBe(abortError);
    expect(requests).toHaveLength(1); // no feedback retry
    expect(readdirSync(dir)).toHaveLength(0); // no *.failed.json dump
  });
});
