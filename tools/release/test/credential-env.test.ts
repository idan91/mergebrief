import { describe, expect, it } from "vitest";
import { stripCredentialVariables } from "../src/logic/credential-env";

describe("stripping credentials from a child environment", () => {
  it("drops every token the publish and CI environments carry", () => {
    const env = {
      MERGEBRIEF_PUBLISH_TOKEN: "ghs_publish",
      GH_TOKEN: "gho_cli",
      GITHUB_TOKEN: "ghs_actions",
      ACTIONS_RUNTIME_TOKEN: "runtime",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc",
      ACTIONS_ID_TOKEN_REQUEST_URL: "https://oidc.example",
      NPM_TOKEN: "npm_x",
      NODE_AUTH_TOKEN: "npm_y",
      PATH: "/usr/bin",
    };

    expect(stripCredentialVariables(env)).toEqual({ PATH: "/usr/bin" });
  });

  it("drops any token, secret, key or password shaped name", () => {
    const env = {
      ANTHROPIC_API_KEY: "sk-ant",
      SESSION_SECRET: "s",
      PGPASSWORD: "p",
      POSTGRES_PASSWORD: "p",
      aws_secret_access_key: "lower",
      HOME: "/home/runner",
      KEYBOARD_LAYOUT: "us",
      MONKEY: "kept",
    };

    expect(stripCredentialVariables(env)).toEqual({
      HOME: "/home/runner",
      KEYBOARD_LAYOUT: "us",
      MONKEY: "kept",
    });
  });

  it("drops git's environment config as one group, count included", () => {
    const env = {
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "safe.directory",
      GIT_CONFIG_VALUE_0: "*",
      GIT_CONFIG_KEY_1: "http.extraheader",
      GIT_CONFIG_VALUE_1: "AUTHORIZATION: basic eDp5",
      GIT_CONFIG_PARAMETERS: "'http.extraheader'='AUTHORIZATION: basic eDp5'",
      GIT_CONFIG_GLOBAL: "/home/runner/.gitconfig",
      GIT_DIR: "/repo/.git",
    };

    expect(stripCredentialVariables(env)).toEqual({
      GIT_CONFIG_GLOBAL: "/home/runner/.gitconfig",
      GIT_DIR: "/repo/.git",
    });
  });
});
