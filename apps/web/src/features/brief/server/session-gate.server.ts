import "@tanstack/react-start/server-only";

import type { Logger } from "logging";
import { LocalBriefErrorCodes } from "../utils/briefErrors";

// The API's session gate decides; this module only relays its answer to the
// file readers and fails closed on anything but an ok. Thrown messages are
// curated codes because TanStack serializes them to the browser.

export type SessionGateSink = Pick<Logger, "warn">;

const UNAUTHORIZED_STATUS = 401;

export async function assertViewerSession(
  probe: () => Promise<Response>,
  sink: SessionGateSink,
): Promise<void> {
  let response: Response;
  try {
    response = await probe();
  } catch (error) {
    sink.warn("local brief session probe failed", { err: error });
    // oxlint-disable-next-line preserve-caught-error -- cause would serialize to the browser
    throw new Error(LocalBriefErrorCodes.UNEXPECTED);
  }

  if (response.ok) {
    return;
  }
  if (response.status === UNAUTHORIZED_STATUS) {
    throw new Error(LocalBriefErrorCodes.UNAUTHENTICATED);
  }

  sink.warn("local brief session probe refused", { status: response.status });
  throw new Error(LocalBriefErrorCodes.UNEXPECTED);
}
