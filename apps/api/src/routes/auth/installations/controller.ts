// Hono-free. The reachable set comes from the shared resolver, at most 60 s
// old; a switch target is honoured ONLY if it is in that set, with NO
// session/settings mutation otherwise; the handler owns the wire posture.
import type { Result } from "types/utils";
import type {
  InstallationsControllerDeps,
  InstallationsFailure,
  ListInstallationsBody,
  SelectInstallationBody,
  SelectInstallationInput,
} from "./types";

type ListResult = Result<ListInstallationsBody, InstallationsFailure>;
type SelectResult = Result<SelectInstallationBody, InstallationsFailure>;

export default {
  /** The accessible set annotated with current (session) + default (settings). */
  async listInstallations({
    installations: reachable,
    session,
    log,
    settings: settingsStore,
  }: InstallationsControllerDeps) {
    const resolved = await reachable.resolve(session, log);
    if (!resolved.ok) {
      return resolved;
    }
    const { installations, session: currentSession } = resolved.value;
    const settings = await settingsStore.get(currentSession.reviewerId);
    const defaultId = settings?.defaultInstallationId ?? null;
    const currentId = currentSession.installationId;

    return {
      ok: true,
      value: {
        installations: installations.map((installation) => ({
          installationId: String(installation.installationId),
          accountLogin: installation.accountLogin,
          isCurrent: installation.installationId === currentId,
          isDefault:
            defaultId !== null && installation.installationId === defaultId,
        })),
        currentInstallationId: String(currentId),
        defaultInstallationId: defaultId === null ? null : String(defaultId),
      },
    } satisfies ListResult;
  },

  /** Rebind the session to a different installation in the reachable set. */
  async selectInstallation(
    {
      installations: reachable,
      session,
      log,
      sessions,
      settings,
    }: InstallationsControllerDeps,
    input: SelectInstallationInput,
  ) {
    const resolved = await reachable.resolve(session, log);
    if (!resolved.ok) {
      return resolved;
    }
    const { installations, session: currentSession } = resolved.value;

    // Validate against the reachable set; never trust the caller's id. A
    // target the viewer can no longer reach mutates NOTHING.
    const targetIsAccessible = installations.some(
      (installation) => installation.installationId === input.target,
    );
    if (!targetIsAccessible) {
      return {
        ok: false,
        error: { kind: "target-not-accessible" },
      } satisfies SelectResult;
    }

    // Atomic, ctx-safe rebinding of the session's tenant stamp.
    const rebound = await sessions.rebindInstallation(
      currentSession.sessionTokenHash,
      input.target,
    );
    if (!rebound.ok) {
      // The row vanished between resolve and rebind (logout / sweep).
      return {
        ok: false,
        error: { kind: "session-vanished" },
      } satisfies SelectResult;
    }

    let defaultId =
      (await settings.get(currentSession.reviewerId))?.defaultInstallationId ??
      null;
    if (input.setDefault) {
      const updated = await settings.setDefaultInstallation(
        currentSession.reviewerId,
        input.target,
      );
      defaultId = updated.defaultInstallationId;
    }

    return {
      ok: true,
      value: {
        currentInstallationId: String(input.target),
        defaultInstallationId: defaultId === null ? null : String(defaultId),
      },
    } satisfies SelectResult;
  },
};
