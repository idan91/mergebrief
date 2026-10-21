import { CredentialFailureCodes } from "github";
import { createSessionAuth, type KeyProvider } from "persistence";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAuthDeps,
  createKeyProvider,
  getRequestUrl,
} from "../../test/fixtures";
import { testLogger } from "../../test/logging";
import { ACCESS_TOKEN, seedSignIn } from "../../test/sign-in";
import { derivePrincipalFromSession } from "../routes/auth/session/logic/principal";
import type {
  AuthRouteDeps,
  ViewerPrincipal,
} from "../routes/auth/session/types";
import { createSessionCredential } from "./session-credential";
import { registerSharedPglite } from "../../test/shared-pglite";

const ROTATED_ACCESS = "ghu_ROTATED_ACCESS_PLAINTEXT";

interface TokenEndpoint {
  readonly calls: () => number;
}

function stubTokenEndpoint(): TokenEndpoint {
  let calls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request): Promise<Response> => {
      if (!getRequestUrl(input).includes("/login/oauth/access_token")) {
        throw new Error(`unexpected fetch: ${getRequestUrl(input)}`);
      }
      calls += 1;
      const body = {
        access_token: ROTATED_ACCESS,
        refresh_token: "ghr_ROTATED_REFRESH_PLAINTEXT",
        expires_in: 28_800,
        refresh_token_expires_in: 15_897_600,
        token_type: "bearer",
        scope: "",
      };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: {
          "content-type": "application/json",
          date: new Date().toUTCString(),
        },
      });
    }),
  );
  return { calls: () => calls };
}

describe("createSessionCredential", () => {
  const harness = registerSharedPglite();
  let kp: KeyProvider;
  let deps: AuthRouteDeps;

  async function signIn(): Promise<ViewerPrincipal> {
    const { cookieHash } = await seedSignIn(harness.handle, kp);
    const found = await createSessionAuth(harness.handle).findSession(
      cookieHash,
    );
    if (found === undefined) {
      throw new Error("seeded session missing");
    }
    return derivePrincipalFromSession(found);
  }

  beforeEach(() => {
    kp = createKeyProvider();
    deps = { handle: harness.handle, auth: buildAuthDeps(kp) };
  });

  it("reads the session's own token", async () => {
    const credential = createSessionCredential(
      deps,
      await signIn(),
      testLogger(),
    );

    expect(await credential.readToken()).toEqual({
      ok: true,
      value: ACCESS_TOKEN,
    });
  });

  it("renews once for concurrent rejections and keeps the rotation", async () => {
    const endpoint = stubTokenEndpoint();
    const principal = await signIn();
    const credential = createSessionCredential(deps, principal, testLogger());

    const renewed = await Promise.all([
      credential.renewToken(ACCESS_TOKEN),
      credential.renewToken(ACCESS_TOKEN),
    ]);
    const rejectedAgain = await credential.renewToken(ROTATED_ACCESS);

    expect(renewed).toEqual([ROTATED_ACCESS, ROTATED_ACCESS]);
    expect(rejectedAgain).toBe(ROTATED_ACCESS);
    expect(endpoint.calls()).toBe(1);
    expect(credential.session().ghTokenCiphertext).not.toBe(
      principal.ghTokenCiphertext,
    );
    expect(await credential.readToken()).toEqual({
      ok: true,
      value: ROTATED_ACCESS,
    });
  });

  it("deletes the session when its token will not decrypt", async () => {
    const principal = await signIn();
    const unreadable = {
      ...principal,
      ghTokenCiphertext: "not-a-sealed-token",
    };
    const credential = createSessionCredential(deps, unreadable, testLogger());

    const token = await credential.readToken();

    expect(token.ok).toBe(false);
    expect(token.ok ? undefined : token.error.code).toBe(
      CredentialFailureCodes.CREDENTIAL_UNREADABLE,
    );
    const session = await createSessionAuth(harness.handle).findSession(
      principal.sessionTokenHash,
    );
    expect(session).toBeUndefined();
  });
});
