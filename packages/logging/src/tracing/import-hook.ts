import { register } from "node:module";
import { createAddHookMessageChannel } from "import-in-the-middle";

// A loader hook cannot be unregistered, so a restart reuses the first one.
let waitForHooks: (() => Promise<void>) | undefined;

/**
 * Registers import-in-the-middle's loader hook so the http instrumentation
 * can patch `node:http` under ESM; undici and pg need no hook. The specifier
 * resolves from this package, the same copy `@opentelemetry/instrumentation`
 * resolves. Await the returned function once the instrumentations are
 * registered, so their hooks are in place before the app's imports run.
 */
export function registerImportHook(): () => Promise<void> {
  if (waitForHooks !== undefined) {
    return waitForHooks;
  }
  const { registerOptions, waitForAllMessagesAcknowledged } =
    createAddHookMessageChannel();
  register("import-in-the-middle/hook.mjs", import.meta.url, registerOptions);
  waitForHooks = waitForAllMessagesAcknowledged;
  return waitForHooks;
}
