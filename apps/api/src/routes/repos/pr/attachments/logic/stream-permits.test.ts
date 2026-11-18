import { describe, expect, it } from "vitest";
import { createStreamPermits } from "./stream-permits";

describe("createStreamPermits", () => {
  it("opens up to the limit and refuses the next", () => {
    const permits = createStreamPermits(2);

    const opened = [permits.acquire(), permits.acquire()];

    expect(opened.every((permit) => permit !== undefined)).toBe(true);
    expect(permits.acquire()).toBeUndefined();
    expect(permits.countOpen()).toBe(2);
  });

  it("frees one permit when a stream is released", () => {
    const permits = createStreamPermits(1);
    const permit = permits.acquire();

    permit?.release();

    expect(permits.countOpen()).toBe(0);
    expect(permits.acquire()).toBeDefined();
  });

  it("frees a permit once however often it is released", () => {
    const permits = createStreamPermits(2);
    const first = permits.acquire();
    permits.acquire();

    first?.release();
    first?.release();

    expect(permits.countOpen()).toBe(1);
  });
});
