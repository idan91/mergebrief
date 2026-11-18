import { describeGitHubContract } from "./harness";
import { createOctokitAdapter } from "./octokit-adapter";

describeGitHubContract("octokit", createOctokitAdapter);
