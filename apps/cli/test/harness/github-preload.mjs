// Fetch-level GitHub redirect for the API process the CLI suites drive
// (loaded via NODE_OPTIONS --import). Every `api.github.com` call is sent to
// the stub the TEST process is running, so a suite keeps writing its GitHub
// responses in its own file and stays network-free across the process
// boundary. Anything else reaches the real fetch, which is how the CLI's own
// requests to the API still work.
const STUB_ORIGIN = process.env.MERGEBRIEF_GITHUB_STUB_ORIGIN;
const GITHUB_ORIGIN = "https://api.github.com";
const realFetch = globalThis.fetch;

/** The request URL, whatever shape `fetch` was handed. */
function readRequestUrl(input) {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

globalThis.fetch = async (input, init) => {
  if (STUB_ORIGIN === undefined || STUB_ORIGIN === "") {
    return realFetch(input, init);
  }
  const url = readRequestUrl(input);
  if (!url.startsWith(GITHUB_ORIGIN)) {
    return realFetch(input, init);
  }
  const redirected = `${STUB_ORIGIN}${url.slice(GITHUB_ORIGIN.length)}`;
  if (typeof input === "string" || input instanceof URL) {
    return realFetch(redirected, init);
  }
  // A Request carries its own method, headers and body; rebuild it against
  // the stub rather than dropping them.
  return realFetch(new Request(redirected, input), init);
};
