// The GitHub stub, running in the TEST process so a suite keeps writing its
// responses as plain functions over a URL and keeps counting calls in its own
// closures. The API process reaches it because `github-preload.mjs` rewrites
// `api.github.com` to this server's origin.
import { createServer, type Server } from "node:http";

/** What a suite supplies: a URL in, a Response out. */
export type GitHubHandler = (url: string) => Promise<Response> | Response;

export interface GitHubStub {
  readonly origin: string;
  /** Install the responses for the test about to run. */
  serve(handler: GitHubHandler): void;
  /** Every path the API asked for, in order, for a call-shape assertion. */
  readonly requested: string[];
  close(): Promise<void>;
}

function unexpected(url: string): Response {
  return new Response(
    JSON.stringify({ message: `unexpected github endpoint: ${url}` }),
    {
      status: 404,
      headers: { "content-type": "application/json; charset=utf-8" },
    },
  );
}

/**
 * A stub bound to an ephemeral port. The default handler refuses everything,
 * so a suite that forgets to declare an endpoint fails loudly rather than
 * reaching the network.
 */
export async function startGitHubStub(): Promise<GitHubStub> {
  const requested: string[] = [];
  let handler: GitHubHandler = (url) => unexpected(url);
  const server: Server = createServer((request, response) => {
    void (async () => {
      const url = `https://api.github.com${request.url ?? ""}`;
      requested.push(request.url ?? "");
      const answer = await handler(url);
      const headers: Record<string, string> = {};
      for (const [name, value] of answer.headers) headers[name] = value;
      response.writeHead(answer.status, headers);
      response.end(Buffer.from(await answer.arrayBuffer()));
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port =
    address !== null && typeof address === "object" ? address.port : 0;
  return {
    origin: `http://127.0.0.1:${String(port)}`,
    serve: (next) => {
      handler = next;
    },
    requested,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
