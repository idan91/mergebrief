// Composes the real app against a PGlite harness purely to run route
// composition, which is what registers the catalog. Nothing is served and
// the github ports throw if touched.
import { randomBytes } from "node:crypto";
import { createEnvKeyProvider } from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { createApp, type ApiApp, type AuthDeps } from "../src/index";
import { testLogger } from "./logging";
import { buildAuthDeps, KEY_REF } from "./fixtures";
import { UNUSED_INSTALLATION_DEPS } from "./reviewer-github";

export interface ComposedCatalog {
  readonly app: ApiApp;
  readonly harness: PgliteHarness;
}

export async function composeCatalog(): Promise<ComposedCatalog> {
  const harness = await createPgliteHarness();
  const auth: AuthDeps = buildAuthDeps(
    createEnvKeyProvider({
      [KEY_REF]: randomBytes(32).toString("base64"),
    }),
  );
  const app = createApp({
    logger: testLogger(),
    handle: harness.handle,
    webhookSecret: "test-webhook-secret",
    auth,
    ...UNUSED_INSTALLATION_DEPS,
  });
  return { app, harness };
}
