// Remove the container THIS invocation created, and nothing else. Playwright
// runs the teardown even when the setup threw, so removing by name — or by an
// id read from a shared file — would take the container belonging to the run
// that actually holds it. The id file is keyed by this process's pid and
// written only after a successful `docker run`; absent means this invocation
// created nothing to clean up.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { CONTAINER_ID_PATH } from "./env";

// oxlint-disable-next-line no-default-export -- playwright loads globalTeardown by default export
export default function globalTeardown(): void {
  if (!existsSync(CONTAINER_ID_PATH)) {
    return;
  }
  const containerId = readFileSync(CONTAINER_ID_PATH, "utf8").trim();
  rmSync(CONTAINER_ID_PATH, { force: true });
  if (containerId === "") {
    return;
  }
  try {
    execFileSync("docker", ["rm", "-f", containerId]);
  } catch {
    // Already gone, or docker is not reachable — nothing to clean up.
  }
}
