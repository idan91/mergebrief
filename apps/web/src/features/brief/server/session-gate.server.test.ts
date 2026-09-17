import { describe, expect, it } from "vitest";
import { LocalBriefErrorCodes } from "../utils/briefErrors";
import {
  assertViewerSession,
  type SessionGateSink,
} from "./session-gate.server";

function stubProbe(status: number): () => Promise<Response> {
  return () => Promise.resolve(new Response(null, { status }));
}

function makeSink(): SessionGateSink & { warnings: string[] } {
  const warnings: string[] = [];
  return {
    warnings,
    warn(msg) {
      warnings.push(msg);
    },
  };
}

describe("assertViewerSession", () => {
  it("resolves when the probe answers ok", async () => {
    const sink = makeSink();
    await expect(
      assertViewerSession(stubProbe(200), sink),
    ).resolves.toBeUndefined();
    expect(sink.warnings).toEqual([]);
  });

  it("refuses with the unauthenticated code on a 401", async () => {
    const sink = makeSink();
    const error = await assertViewerSession(stubProbe(401), sink).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(LocalBriefErrorCodes.UNAUTHENTICATED);
    expect((error as Error).cause).toBeUndefined();
    expect(sink.warnings).toEqual([]);
  });

  it("fails closed and warns on any other status", async () => {
    const sink = makeSink();
    const error = await assertViewerSession(stubProbe(503), sink).catch(
      (caught: unknown) => caught,
    );
    expect((error as Error).message).toBe(LocalBriefErrorCodes.UNEXPECTED);
    expect(sink.warnings).toHaveLength(1);
  });

  it("fails closed and warns when the probe itself rejects", async () => {
    const sink = makeSink();
    const probe = () => Promise.reject(new Error("ECONNREFUSED 127.0.0.1"));
    const error = await assertViewerSession(probe, sink).catch(
      (caught: unknown) => caught,
    );
    expect((error as Error).message).toBe(LocalBriefErrorCodes.UNEXPECTED);
    expect((error as Error).cause).toBeUndefined();
    expect(sink.warnings).toHaveLength(1);
    expect(sink.warnings[0]).not.toContain("ECONNREFUSED");
  });
});
