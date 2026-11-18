import "@tanstack/react-start/server-only";

let loaded = false;

/**
 * The web process's one `process.env` reader. Loads `apps/web/.env` once so
 * the file's values are honoured whichever module asks first, then hands out
 * the live env: a variable set later is still seen.
 */
export function getServerEnv(): NodeJS.ProcessEnv {
  if (!loaded) {
    try {
      process.loadEnvFile();
    } catch {
      // No .env file; the vars may still be set in the ambient env.
    }
    loaded = true;
  }
  return process.env;
}
