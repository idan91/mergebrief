import { createSessionAuth } from "persistence";
import { describe, expect, it } from "vitest";
import { buildAuthDeps, createKeyProvider } from "../../../../test/fixtures";
import { testLogger } from "../../../../test/logging";
import { registerSharedPglite } from "../../../../test/shared-pglite";
import { seedSignIn } from "../../../../test/sign-in";
import { derivePrincipalFromSession } from "../session/logic/principal";
import type { ViewerPrincipal } from "../session/types";
import { tokensController } from "./controller";
import { AccessLevels } from "types/access-levels";

const MINT_INPUT = {
  name: "cli",
  scope: AccessLevels.READ,
  expiresInDays: null,
  tokenPrefix: "mergebrief_",
} as const;

describe("tokensController.mintToken", () => {
  const harness = registerSharedPglite();
  const keyProvider = createKeyProvider();

  async function makeSignedInPrincipal(): Promise<ViewerPrincipal> {
    const { cookieHash } = await seedSignIn(harness.handle, keyProvider);
    const found = await createSessionAuth(harness.handle).findSession(
      cookieHash,
    );
    if (found === undefined) {
      throw new Error("seeded session missing");
    }
    return derivePrincipalFromSession(found);
  }

  function mintFor(session: ViewerPrincipal) {
    return tokensController.mintToken(
      {
        deps: { handle: harness.handle, auth: buildAuthDeps(keyProvider) },
        session,
        log: testLogger(),
      },
      MINT_INPUT,
    );
  }

  it("mints on the signed-in session's grant", async () => {
    const session = await makeSignedInPrincipal();

    const minted = await mintFor(session);

    expect(minted.ok).toBe(true);
  });

  it("answers session-gone when a logout deleted the session first", async () => {
    const session = await makeSignedInPrincipal();
    await createSessionAuth(harness.handle).deleteSession(
      session.sessionTokenHash,
    );

    const minted = await mintFor(session);

    expect(minted.ok ? undefined : minted.error.kind).toBe("session-gone");
  });
});
