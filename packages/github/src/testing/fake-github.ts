import { buildAccountReader, buildReviewerAccount } from "./account-reader";
import { buildInstallationRepoClient } from "./installation-repo";
import { buildRepoReader } from "./repo-reader";
import { buildReviewerRepoClient } from "./reviewer-repo";
import { InstallationPresences } from "../operations/installation/types";
import {
  createExchange,
  createFixedRunner,
  createInstallationRunner,
  createReviewerRunners,
} from "./runners";
import { CredentialKinds, type FakeGitHub } from "./types";
import { answerNotFound, answerOk } from "./utils";
import { createFakeWorld } from "./world";

/**
 * An empty in-memory GitHub: a test arranges what exists, binds the
 * credentials the code under test would, and asserts on `calls`.
 */
export function makeFakeGitHub(): FakeGitHub {
  const world = createFakeWorld();
  const exchange = createExchange();
  const { send } = exchange;

  return {
    ...world,
    failOn(operation, failure, credential) {
      exchange.failOn(operation, failure, credential);
    },
    rejectToken(token) {
      exchange.rejectToken(token);
    },
    calls: exchange.calls,
    listCalls(operation) {
      return exchange.calls.filter((call) => call.operation === operation);
    },
    readComments(repo) {
      return new Map(world.findRepo(repo)?.comments);
    },
    bindReviewerGitHub(credential, options) {
      const runners = createReviewerRunners(send, credential, options);
      return {
        ...buildAccountReader(world, runners.own),
        ...buildReviewerAccount(world, runners.own),
        forRepo(repo) {
          const read = runners.forRepo(repo);
          return buildReviewerRepoClient(world, repo, {
            read,
            own: runners.own,
          });
        },
      };
    },
    bindInstallationGitHub(installationId) {
      const run = createInstallationRunner(send, installationId, (id) =>
        world.isInstallationRemoved(id),
      );
      return {
        ...buildAccountReader(world, run),
        forRepo(repo) {
          return buildInstallationRepoClient(world, repo, run);
        },
        listInstallationRepoIds() {
          return run({
            operation: "listInstallationRepoIds",
            input: { installationId },
            answer: () =>
              answerOk(world.findInstallationRepoIds(installationId)),
          });
        },
      };
    },
    async readInstallationPresence(installationId) {
      return send(
        { kind: CredentialKinds.APP },
        {
          operation: "readInstallationPresence",
          input: { installationId },
          onNotFound: () => InstallationPresences.GONE,
          answer: () => {
            if (world.isInstallationRemoved(installationId)) {
              return answerNotFound("read installation presence");
            }
            return answerOk(InstallationPresences.PRESENT);
          },
        },
      );
    },
    bindOperatorGitHub(token) {
      const run = createFixedRunner(send, {
        kind: CredentialKinds.OPERATOR,
        token,
      });
      return {
        ...buildAccountReader(world, run),
        forRepo(repo) {
          return buildRepoReader(world, repo, run);
        },
      };
    },
  };
}
