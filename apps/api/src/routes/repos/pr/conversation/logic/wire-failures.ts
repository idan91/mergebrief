import { NotFound } from "../../../../../shared-errors/api-error";
import { resolveGitHubDenialError } from "../../../../../shared-errors/github-denial";
import {
  DenialPostures,
  type DenialPosture,
} from "../../../../../shared-errors/github-denial/types";
import {
  ConversationCredentials,
  type ConversationCredential,
  type ReadConversationFailure,
} from "../types";

/** The App's 401 is the instance's credential, so it answers 502, never 401. */
const POSTURE_BY_CREDENTIAL: Record<ConversationCredential, DenialPosture> = {
  [ConversationCredentials.APP]: DenialPostures.APP_READ,
  [ConversationCredentials.VIEWER]: DenialPostures.COLLAPSE,
};

export function throwReadConversationFailure(
  failure: ReadConversationFailure,
): never {
  if (failure.kind === "not-found") {
    throw new NotFound();
  }
  const posture = POSTURE_BY_CREDENTIAL[failure.credential];
  throw resolveGitHubDenialError(failure.error, posture);
}
