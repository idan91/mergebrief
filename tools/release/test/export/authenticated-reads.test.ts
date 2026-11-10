import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGitPort } from "../../src/logic/git-port";
import { makeGitRepos } from "../helpers";

const TOKEN = "ghs_sekrit";
const TAG_SHA = "1".repeat(40);
const NO_CREDENTIAL = "none";
const VISIBLE = "visible";
const HIDDEN = "hidden";

// A private repository as git sees one over HTTP: 401 without credentials,
// 403 for the wrong ones, and one v tag advertised to the right ones, or
// GitHub's 404 when the credential is valid but cannot see the repository.
// It runs in its own process because the port's git calls block this one.
const PRIVATE_REMOTE_SERVER = `
const http = require("node:http");
const fs = require("node:fs");
const [logFile, accepted, sha, visibility] = process.argv.slice(1);
const pkt = (text) => (text.length + 4).toString(16).padStart(4, "0") + text;
const advertisement =
  pkt("# service=git-upload-pack\\n") + "0000" +
  pkt(sha + " refs/tags/v0.1.0\\0agent=test\\n") + "0000";
const server = http.createServer((request, response) => {
  const given = request.headers.authorization;
  fs.appendFileSync(logFile, (given ?? "${NO_CREDENTIAL}") + "\\n");
  if (given === undefined) {
    response.writeHead(401, { "WWW-Authenticate": 'Basic realm="private"' });
  } else if (given !== accepted) {
    response.writeHead(403);
  } else if (visibility === "${HIDDEN}") {
    response.writeHead(404);
  } else {
    response.writeHead(200, {
      "Content-Type": "application/x-git-upload-pack-advertisement",
    });
    response.write(advertisement);
  }
  response.end();
});
server.listen(0, "127.0.0.1", () => console.log(server.address().port));
`;

const servers: ChildProcess[] = [];
const made: string[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.kill();
  }
  for (const root of made.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function encodeBasicCredential(token: string): string {
  const pair = Buffer.from(`x-access-token:${token}`);
  return `Basic ${pair.toString("base64")}`;
}

/** A clone to run git in, and a private remote that accepts `TOKEN` only; `HIDDEN` answers that token 404. */
async function startPrivateRemote(visibility = VISIBLE) {
  const repos = makeGitRepos({ "README.md": "read me\n" });
  made.push(repos.root);
  const logFile = join(repos.root, "credentials.log");
  const server = spawn(
    process.execPath,
    [
      "-e",
      PRIVATE_REMOTE_SERVER,
      logFile,
      encodeBasicCredential(TOKEN),
      TAG_SHA,
      visibility,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  servers.push(server);

  const [listening] = (await once(server.stdout, "data")) as [Buffer];
  const port = listening.toString().trim();
  return {
    clone: repos.clone,
    url: `http://127.0.0.1:${port}/mergebrief.git`,
    readCredentialsSent: () => readFileSync(logFile, "utf8").trim().split("\n"),
  };
}

describe("reading a target repository that is still private", () => {
  it("reads the tags with the token when the port is given one", async () => {
    const remote = await startPrivateRemote();
    const port = createGitPort(remote.clone, {
      env: process.env,
      publicReadToken: TOKEN,
    });

    const tags = port.listPublicTags(remote.url);
    const refs = port.fetchPublic(remote.url);

    expect(tags).toEqual(["v0.1.0"]);
    expect(refs).toEqual({ tags: new Map([["v0.1.0", TAG_SHA]]) });
    expect(remote.readCredentialsSent()).toContain(
      encodeBasicCredential(TOKEN),
    );
  });

  it("sends no credential by default, whatever the environment holds", async () => {
    const remote = await startPrivateRemote();
    const port = createGitPort(remote.clone, {
      env: { ...process.env, MERGEBRIEF_PUBLISH_TOKEN: TOKEN },
    });

    const tags = port.listPublicTags(remote.url);
    const refs = port.fetchPublic(remote.url);

    expect(tags).toBeUndefined();
    expect(refs).toBeUndefined();
    const sent = new Set(remote.readCredentialsSent());
    expect(sent).toEqual(new Set([NO_CREDENTIAL]));
  });

  it("reads a target the token cannot see as no repository there", async () => {
    const remote = await startPrivateRemote(HIDDEN);
    const port = createGitPort(remote.clone, {
      env: process.env,
      publicReadToken: TOKEN,
    });

    const tags = port.listPublicTags(remote.url);
    const refs = port.fetchPublic(remote.url);

    expect(tags).toBeUndefined();
    expect(refs).toBeUndefined();
    expect(remote.readCredentialsSent()).toContain(
      encodeBasicCredential(TOKEN),
    );
  });

  it("keeps a rejected token out of the failure message", async () => {
    const remote = await startPrivateRemote();
    const rejected = "ghs_rejected";
    const port = createGitPort(remote.clone, {
      env: process.env,
      publicReadToken: rejected,
    });

    const read = () => port.listPublicTags(remote.url);

    expect(read).toThrow(/403/);
    expect(read).not.toThrow(new RegExp(rejected));
  });
});
