import { createFakeAdapter } from "./fake-adapter";
import { describeGitHubContract } from "./harness";

describeGitHubContract("fake", createFakeAdapter);
