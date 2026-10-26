import { describe, expect, it } from "vitest";
import { parseArgv } from "../src/logic/argv";
import {
  findCredentialedRemoteFlag,
  hasUrlCredentials,
  REMOTE_FLAGS,
  redactUrlCredentials,
} from "../src/logic/remote-url";

const CREDENTIALED_URL = "https://user:fake-token@example.invalid/repo.git";

function parseRemote(flag: string, url: string) {
  const parsed = parseArgv([flag, url], {
    valued: [...REMOTE_FLAGS],
    boolean: [],
    maxPositionals: 0,
  });
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.value;
}

describe("remote URL credentials", () => {
  it("spots userinfo with or without a password", () => {
    expect(hasUrlCredentials(CREDENTIALED_URL)).toBe(true);
    expect(hasUrlCredentials("https://fake-token@example.invalid/r")).toBe(
      true,
    );
  });

  it("passes plain URLs, file URLs, paths and scp-style remotes", () => {
    expect(hasUrlCredentials("https://example.invalid/repo.git")).toBe(false);
    expect(hasUrlCredentials("file:///tmp/public.git")).toBe(false);
    expect(hasUrlCredentials("/tmp/public.git")).toBe(false);
    expect(hasUrlCredentials("git@github.com:owner/repo.git")).toBe(false);
  });

  it("redacts every URL's userinfo in a line", () => {
    const line = `push ${CREDENTIALED_URL} and https://other:fake@host/x`;

    const redacted = redactUrlCredentials(line);

    expect(redacted).toBe(
      "push https://<redacted>@example.invalid/repo.git and https://<redacted>@host/x",
    );
  });

  it("redacts a password holding an at sign whole", () => {
    const redacted = redactUrlCredentials("https://user:p@ss@host/x");

    expect(redacted).toBe("https://<redacted>@host/x");
  });

  it.each(REMOTE_FLAGS)("names %s when its URL carries credentials", (flag) => {
    const parsed = parseRemote(flag, CREDENTIALED_URL);

    expect(findCredentialedRemoteFlag(parsed)).toBe(flag);
  });

  it.each(REMOTE_FLAGS)("lets %s through on a plain file URL", (flag) => {
    const parsed = parseRemote(flag, "file:///tmp/public.git");

    expect(findCredentialedRemoteFlag(parsed)).toBeUndefined();
  });
});
