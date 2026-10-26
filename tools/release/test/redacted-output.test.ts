import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  describeCrash,
  redactStreamOutput,
} from "../src/logic/redacted-output";

const SECRET_URL = "https://user:fake-secret@example.invalid/repo.git";
const REDACTED_URL = "https://<redacted>@example.invalid/repo.git";

function makeCollectingStream(): { stream: Writable; written: string[] } {
  const written: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      written.push(chunk.toString("utf8"));
      callback();
    },
  });
  return { stream, written };
}

describe("redacted stream output", () => {
  it("redacts URL userinfo in every string written", () => {
    const { stream, written } = makeCollectingStream();
    redactStreamOutput(stream);

    stream.write(`release: unknown flag --public-remote=${SECRET_URL}\n`);
    stream.write(`unexpected argument ${SECRET_URL}\n`, "utf8");

    expect(written).toEqual([
      `release: unknown flag --public-remote=${REDACTED_URL}\n`,
      `unexpected argument ${REDACTED_URL}\n`,
    ]);
  });

  it("keeps the write callback with or without an encoding", async () => {
    const { stream, written } = makeCollectingStream();
    redactStreamOutput(stream);

    await new Promise((done) => stream.write(SECRET_URL, done));
    await new Promise((done) => stream.write(SECRET_URL, "utf8", done));

    expect(written).toEqual([REDACTED_URL, REDACTED_URL]);
  });

  it("passes bytes through untouched", () => {
    const { stream, written } = makeCollectingStream();
    redactStreamOutput(stream);

    stream.write(Buffer.from("plain bytes"));

    expect(written).toEqual(["plain bytes"]);
  });
});

describe("crash descriptions", () => {
  it("redacts the message and stack of an error", () => {
    const description = describeCrash(new Error(`open '${SECRET_URL}'`));

    expect(description).toContain(`open '${REDACTED_URL}'`);
    expect(description).not.toContain("fake-secret");
  });

  it("redacts a thrown value that is not an error", () => {
    expect(describeCrash(`bad ${SECRET_URL}`)).toBe(`bad ${REDACTED_URL}`);
  });
});
