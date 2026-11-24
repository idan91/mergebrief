# Choose a model provider

MergeBrief writes each brief with one model, chosen in the `generator:` block of `mergebrief.config.yaml`. With no block it uses Anthropic's Claude Opus 5.5 and the key in `ANTHROPIC_API_KEY`.

| To | Set | Section |
| --- | --- | --- |
| Keep the default | `ANTHROPIC_API_KEY` in `.env`, no `generator:` block | [Use the default](#use-the-default) |
| Use another model | `model:` | [Switch the model](#switch-the-model) |
| Use OpenAI or OpenRouter | `provider: openai` or `provider: openrouter`, and its key | [Switch the provider](#switch-the-provider) |
| Go through a company gateway or your own server | `baseUrl:` | [Route through a gateway](#route-through-a-gateway-or-your-own-server) |
| Change the reasoning effort | `effort:` | [Set the reasoning effort](#set-the-reasoning-effort) |
| Run a vendor CLI under your subscription | `provider: claude-code`, `codex` or `cursor`, host only | [Subscription CLI providers](#subscription-cli-providers) |
| See which model wrote a brief | nothing: read the brief's details | [Check which model wrote a brief](#check-which-model-wrote-a-brief) |

Run every command in the folder that holds `docker-compose.yml`, `.env` and `mergebrief.config.yaml`. Only the worker reads the `generator:` block, so a change to it alone takes `docker compose restart worker`. A key changed in `.env` takes `docker compose up -d` instead, since a restart keeps the old environment. [Apply a change](./configuration.md#apply-a-change) says what every other change needs. The key never goes in `mergebrief.config.yaml`: the file names the variable that holds it, and the value stays in `.env`.

## Use the default

Leave the `generator:` block out, and put your Anthropic key in `.env`:

```dotenv
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

```sh
docker compose up -d
```

Then [check which model wrote a brief](#check-which-model-wrote-a-brief).

## Switch the model

Name the model's id under `generator:`:

```yaml
# mergebrief.config.yaml
generator:
  provider: anthropic
  model: claude-sonnet-5-5
```

```sh
docker compose restart worker
```

Claude Sonnet 5.5 costs less per token than the default ([Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)), and a weaker model can write longer, less stable text ([Brief text runs long on a weaker model](#brief-text-runs-long-on-a-weaker-model)). The id is not the display name: "Claude Sonnet 5.5" is `claude-sonnet-5-5`. [Model names by provider](#model-names-by-provider) says where each provider lists its ids and what a wrong one does.

Briefs already written keep their text, and the next push re-uses the groups it did not touch. To have the first push after a model change write a whole new brief, add `fullRegeneration: on-model-swap` to the block ([configuration.md](./configuration.md#generator)).

## Switch the provider

Each provider reads its key from its own variable. Put the `generator:` block in `mergebrief.config.yaml` and the key in `.env`, then run `docker compose up -d`. A new key recreates the worker, which then reads the config file too; if the key was already in `.env`, also run `docker compose restart worker`. You can leave `ANTHROPIC_API_KEY` in `.env`; nothing reads it once another provider is set.

### OpenAI

```yaml
# mergebrief.config.yaml
generator:
  provider: openai
  model: gpt-6.1-sol   # required: an id from the OpenAI models page
```

```dotenv
OPENAI_API_KEY=sk-your-key-here
```

```sh
docker compose up -d
```

At boot the worker asks OpenAI for the model. A wrong id refuses boot, and `docker compose logs worker` ends with a `worker composition: invalid generator configuration` line naming it.

### OpenRouter

```yaml
# mergebrief.config.yaml
generator:
  provider: openrouter
  model: anthropic/claude-sonnet-5.5   # required: the full slug, vendor prefix included
```

```dotenv
OPENROUTER_API_KEY=sk-or-your-key-here
```

```sh
docker compose up -d
```

At boot the worker checks that the slug exists and supports structured outputs; either failure refuses boot. OpenRouter forwards each request to an upstream that serves the model. The worker asks only for upstreams that keep no request data (`data_collection: deny`), so a model with no such upstream fails its request with OpenRouter's own error. To choose differently, name the policy yourself:

```yaml
generator:
  provider: openrouter
  model: anthropic/claude-sonnet-5.5
  providerRouting:
    data_collection: allow   # or keep deny and add zdr: true for zero-data-retention endpoints only
```

`providerRouting` takes any of [OpenRouter's routing options](https://openrouter.ai/docs/features/provider-routing), such as `order` or `sort: throughput`. `referer` and `title` set OpenRouter's attribution headers.

### Keep the key under another variable name

`apiKeyEnv` names the variable instead of the default, for example when one `.env` holds keys for two instances:

```yaml
generator:
  provider: anthropic
  apiKeyEnv: MERGEBRIEF_ANTHROPIC_KEY
```

```dotenv
MERGEBRIEF_ANTHROPIC_KEY=sk-ant-your-key-here
```

The value of `apiKeyEnv` is a variable name in capitals, never the key itself; a key pasted there refuses boot without echoing it.

## Route through a gateway or your own server

`baseUrl` sends generations to another host, such as a company LLM gateway or a self-hosted server that speaks the OpenAI API. It works with `anthropic` and `openai`.

For an Anthropic gateway, give the host root without `/v1`; the SDK appends `/v1/messages`, and a `baseUrl` ending in `/v1` refuses boot:

```yaml
generator:
  provider: anthropic
  baseUrl: https://llm-gateway.example.com
```

For an OpenAI-compatible gateway or server, give its `/v1` root; the SDK appends `/chat/completions`. The boot check of the model becomes a warning, since your server decides which ids exist:

```yaml
generator:
  provider: openai
  model: your-served-model
  baseUrl: https://llm.example.internal/v1
```

Then `docker compose restart worker`.

What to know about a gateway:

- **Only this file picks the host.** The worker ignores `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `OPENAI_BASE_URL`, `OPENAI_ORG_ID`, `OPENAI_PROJECT_ID` and `OPENAI_ADMIN_KEY`.
- **Extra headers go in `.env`.** `ANTHROPIC_CUSTOM_HEADERS` or `OPENAI_CUSTOM_HEADERS` holds `Name: value` lines, one per line, added to every request on the configured host; a line can replace the key header. Quote a multi-line value in single quotes ([configuration.md](./configuration.md#how-values-are-read)).
- **Redirects are refused.** The request carries your key and the pull request's code, so the worker never follows one. A `baseUrl` that redirects, such as an `http://` address a gateway upgrades to `https://`, fails the generation as a configuration error naming the redirect. Set `baseUrl` to the address it redirects to.
- **Plain `http://` warns.** A `baseUrl` on `http://` to any host but the worker's own logs one warning at boot, because the key and the code then travel unencrypted.

## Check which model wrote a brief

1. **The worker started.** `docker compose ps -a` shows `worker` as `Up`, and its log has a start line:

   ```sh
   docker compose logs worker | grep 'listening for generate jobs'
   ```

   A worker at `Exited (0)` refused its config; the last line of `docker compose logs worker` names the problem ([A service exits with code 0](./troubleshooting.md#a-service-exits-with-code-0)).

2. **The next brief names it.** Push a commit to an open pull request in an installed repository and open its brief in MergeBrief. Click the **i** button (Brief details) in the brief's header: under **Generation**, **Provider** and **Model** name what wrote it, and **Effort** the reasoning effort.

A brief written before the change still names the model that wrote it.

## Set the reasoning effort

`effort` takes `low`, `medium` (the default) or `high` and applies to every generation:

```yaml
generator:
  provider: anthropic
  effort: high
```

What each provider does with it is in [the provider table](#the-six-providers). A model or provider without the knob records `effort: null`, shown on the brief's details.

## Subscription CLI providers

`claude-code`, `codex` and `cursor` run a vendor CLI under your own subscription login instead of an API key. They run only as host processes from a source checkout, never in the image: under compose, a CLI provider refuses worker boot with `worker composition: invalid generator configuration`. The [contributor notes](../dev/harness-cli-providers.md) cover running one, the billing route, and how each CLI is held in.

### What stays open

A CLI reads pull request text written by people you may not trust, so someone can write instructions into a description, a diff or a comment and hope the model follows them. MergeBrief fences that text as data, but no prompt makes that a guarantee. What protects your machine is what each CLI can reach:

- **claude-code:** nothing it can act with. Every tool is off, with no MCP servers and no settings, and its environment holds only process basics, proxy and CA settings, and its login variables.
- **codex:** its shell, web search, browser, computer-use, image, plugin and sub-agent tools are off, and a permission profile lets the rest read only its own install folders, minimal system paths and an empty working folder, with no network. A newer codex can add tools MergeBrief has not checked; the worker warns at startup when your codex is newer than the tested version.
- **cursor:** a deny-all `.cursor/cli.json` blocked its shell, file reads and web fetches in testing, but cursor enforces that file itself. Your MCP servers under `~/.cursor` still load and may be reachable, `CURSOR_API_KEY` sits in its environment, and nothing limits its network.

With codex or cursor, the worker logs `generator.tool-access` at startup, and every brief they write says, under "Generated by", that a CLI with tool access wrote it. With any provider, pull request text can still steer what a brief says. A brief that contains the value of a secret the worker holds fails as `output-secret` instead of being stored.

On Windows, run a host worker under WSL2, the tested path.

## Reference

### The config file

`docker-compose.yml` mounts the `mergebrief.config.yaml` beside it read-only into `api` and `worker`, and sets `MERGEBRIEF_CONFIG` to the mounted path whatever `.env` says. The image carries no config file, so a missing one stops `docker compose up` with `bind source path does not exist`. The repository ships an annotated template, [`mergebrief.config.example.yaml`](../../mergebrief.config.example.yaml). Every root key, which process reads it and its default are in the [root keys reference](./configuration.md#root-keys).

- **Permissions.** The containers run as UID 1000, so that user must read the file. Under a restrictive `umask`, or when root created it, run `chmod 644 mergebrief.config.yaml`.
- **Another location.** Replace the mount's source in `docker-compose.override.yml`; leave `docker-compose.yml` alone, since an upgrade replaces it ([compose.md](./compose.md#what-the-host-holds)).
- **Refusals.** A problem the worker can find at boot refuses boot with one issue per field, never echoing a value: an unknown provider or key, an unset key variable, a model the provider check rejects. Keys starting with `x-` are ignored; any other unknown root key refuses boot.

A source checkout reads the file from the workspace root instead ([CONTRIBUTING.md](../../CONTRIBUTING.md#environment-in-a-source-checkout)).

### The six providers

| Provider | Runs | Key variable (default) | Effort knob | Notes |
| --- | --- | --- | --- | --- |
| `anthropic` | API | `ANTHROPIC_API_KEY` | yes | The default, on `claude-opus-5-5`. `baseUrl` is the gateway's host root, without `/v1`. |
| `openai` | API | `OPENAI_API_KEY` | found at run time; a model without `reasoning_effort` records `effort: null` | `model` required. `baseUrl` is the `/v1` root of a gateway or compatible server. |
| `openrouter` | API | `OPENROUTER_API_KEY` | only when the model lists `reasoning` support | Full slug required. Boot requires the model to list `structured_outputs`. |
| `claude-code` | host CLI | your `claude /login` | none (`effort: null`) | Refused in the image. The served model is checked after each run. |
| `codex` | host CLI | your `codex login` (ChatGPT; a stored API-key login refuses to start) | yes | Refused in the image. Its output carries no model id, so the brief records the model you configured, unverified. |
| `cursor` | host CLI | your `cursor-agent login`, or `CURSOR_API_KEY` | rides the model id's variant (`gpt-5.2-high`); `effort:` has no effect | Refused in the image. Records the model you configured, unverified. |

An API provider's host is `api.anthropic.com`, `api.openai.com/v1` or `openrouter.ai` unless `baseUrl` says otherwise. Every key of the block is in [configuration.md](./configuration.md#generator).

### Model names by provider

MergeBrief keeps no list of model ids, so a new model works the day its provider ships it. Copy the id from the provider's own page, exactly as written there.

#### `anthropic`

The "Claude API ID" row of the [models overview](https://platform.claude.com/docs/en/models/overview), or `GET /v1/models` with your key. Lowercase, with a hyphen for each space and for the dot: `claude-sonnet-5-5`. Nothing checks the id at boot: a wrong one fails the first generation with a configuration error.

#### `openai`

The [OpenAI models page](https://developers.openai.com/api/docs/models); with `baseUrl` set, whatever your server's `/models` serves. A wrong id refuses boot; with `baseUrl` set, it is a warning.

#### `openrouter`

The full slug from [openrouter.ai/models](https://openrouter.ai/models), vendor prefix included. OpenRouter writes a version with a dot where the vendor may use a hyphen: `anthropic/claude-sonnet-5.5` here, `claude-sonnet-5-5` on the `anthropic` provider. A wrong slug, or one without structured outputs, refuses boot.

#### `claude-code`

Whatever your installed `claude` CLI accepts: an alias such as `opus` or `sonnet`, or a full Anthropic id ([model configuration](https://code.claude.com/docs/en/model-config)). Omitted, `claude-opus-5-5`. A wrong id fails the first generation with `model_not_found`.

#### `codex`

The models your installed `codex` CLI offers ([Codex models](https://learn.chatgpt.com/docs/models)). Omitted, the CLI's own default, recorded as `codex-default`.

#### `cursor`

The list `cursor-agent --list-models` prints, copied exactly, effort variant included (`gpt-5.2-high`). Omitted, the CLI's default, recorded as `cursor-default`. An id with `[` refuses boot; an unknown one fails the first generation with `Cannot use this model`.

### Worker slots

A slot is one generation a worker runs at a time. Three optional `.env` dials set them:

| Variable | Default | What it sets |
| --- | --- | --- |
| `WORKER_CONCURRENCY` | `1` | Ordinary generations one worker runs at once. |
| `WORKER_LARGE_CONCURRENCY` | `1` | Slots of the large pool, for pull requests briefed in several model calls. |
| `WORKER_COUNT` | `1` | Worker containers compose starts. |

Concurrent generations are `WORKER_COUNT` x (`WORKER_CONCURRENCY` + `WORKER_LARGE_CONCURRENCY`). Prefer more slots in one worker: a second worker buys restart isolation, not throughput. [Add worker capacity](./data-and-scaling.md#add-worker-capacity) has the steps and the check.

An API provider holds one response stream per slot, so the limits that matter are the provider's rate limit and the [daily cap](./spend-cap.md). A slot whose run reads a changed lockfile also starts a short-lived child process with a 512 MB heap cap, so plan that much memory per slot.

### The large pool

A diff over 400k input tokens or 120 hunks is briefed in parts: a grouping call, then detail calls, up to `generator.detailConcurrency` of them at once. That decision is made once the diff is read. Before reading it, the worker predicts the same decision from GitHub's counts, a changed file standing for a hunk and about 11,900 changed lines for 400k tokens: a pull request with more than 120 changed files or more changed lines than that moves to the large pool before anything is spent. Its one default slot runs large pull requests one after another while ordinary pushes keep their own slots. A run the prediction missed is still briefed in parts, in the slot it started in. A second large slot costs up to `detailConcurrency` more streams at the provider: on a provider rate limit, lower `detailConcurrency` before you add a large slot.

A large run counts one run against the daily cap when it starts and one more for each part ([What counts](./spend-cap.md#what-counts)).

### What the model receives

The worker sends the provider the pull request's title, description, branch names, file list and diff, the stack neighbours' numbers and titles, the repository's `.mergebrief/` instructions and custom attributes, the primary ticket and up to five linked pages ([security-model.md](./security-model.md#what-the-model-provider-receives)). Before the prompt is built it redacts the credentials it recognizes with high confidence:

- **By format:** private key blocks, GitHub, GitLab, Slack, Stripe, npm, Anthropic and OpenAI tokens, AWS access key ids, Google API keys, JWTs and the password in a URL. Each becomes a marker such as `[redacted:github-token]` on the same line, so line references still match the diff you review, which is never redacted.
- **By name:** a quoted value of 8 to 256 characters, holding a letter and a digit and no white space, under a key ending in `password`, `passwd`, `passphrase`, `secret`, `token`, or `api`, `secret`, `access` or `private` then `key`, and an unquoted `NAME=value` in an env file under such a name in capitals. It becomes `[redacted:keyed-secret]`, and the chunk carries the `adds-secret` flag. A value that reads as a name (`gray-200`, `db-secret-v2`) becomes `[redacted:keyed-name]` with no flag, unless its key holds a password.

Not covered: an unquoted value outside the env-file form (a YAML `password: value`, a `--password=value` flag), a secret passed as a call argument beside its name (`os.Setenv("API_KEY", "...")`), a string with a prefix the rule does not read (`f"..."`, `b"..."`), JSON escaped inside another string, and a Go declaration naming several variables. This is best effort, not data-loss prevention: treat a credential committed to a pull request as leaked and rotate it.

A pull request briefed in parts reads lockfiles and generated files shortened. A pnpm, npm or yarn lockfile reaches the model as its package changes, any other known lockfile (`Cargo.lock`, `go.sum`) as counts only, and a file marked `linguist-generated` or `linguist-vendored` in the default branch's root `.gitattributes` as its path, status, line counts and hunk headers. The brief marks those chunks "Read as package changes" or "Read as counts only", and the receipt counts them under "Files read shortened". A brief written in one call shortens nothing.

### Pushes, rebases and force pushes

After a push, the revision narrative, the delta and the changed-line highlights read the revision span: the pull request's own diff at two heads, and what differs between them. One head is the new push; the other is the previous brief's head, or for a delta the head of the reviewer's last review, so several quick pushes read as one.

A rebase or force push does not retell the commits it rewrote, and merging the base branch in does not show the base branch's changes. A conflict resolution that changes the pull request's own diff does show. A file over 1 MB, or past the span's line-diff budget, skips the line diff, so it can read as changed when only the code around it moved.

#### A push that changes nothing

When the span shows no change, the narrative and the delta make no model call and the page says "No change since the previous brief." The brief makes no model call either if nothing else it reads moved: the title, branch names, stack position, description, linked pages, primary ticket and the repository's `.mergebrief/` files. That run costs nothing against the daily cap. Edit the description and push a rebase, and the brief still calls the model.

#### What carries over

The next brief keeps each group the push left alone and looks again only at the groups it touched. Read marks on kept groups stay; a re-looked group starts unread. A draft comment on a new-side line moves with its code and is orphaned when those lines changed; a draft on the old side is orphaned when the base moved, which a rebase usually does. A reviewer re-places or deletes an orphaned draft before the review can post. `generator.fullRegeneration` turns carrying off ([configuration.md](./configuration.md#generator)).

When changes cannot be matched across a push, Brief details says so and the groups holding them are looked at again. When GitHub cannot serve the old head after a force push, the worker logs `warn` `generate: revision span unavailable; skipping its artifacts`, writes no narrative, delta or highlights, and looks at every group again.

#### The 300-file span limit

A span holds at most 300 changed files, and no setting changes that. A push past it gets no narrative, no delta and no changed-line highlights, and the page says the change was too large to compare. Every group is looked at again, so the brief pays for its model calls in full; read marks do not carry and every line draft is orphaned. The next push compares against this push's brief as usual.

The limit covers the span only: a pull request can change up to 3,000 files and still get a brief. A smaller span also skips the narrative and delta, keeping the highlights and the carried groups, when its changed lines reach `generator.hugeSpanRatio` of the pull request's (0.65 by default) or it exceeds one call's limits.

A fast-forward over an unmoved merge base reads three merge bases and two diffs from GitHub. Any other push also reads both heads' pull request diffs, plus two file reads per file only a line diff can settle. Frequent force pushes on a large pull request spend more of your GitHub rate limit than the same number of fast-forwards.

### When something degrades

The worker repairs some answers instead of failing them: it drops an invalid category entry (salvage), retries once with feedback when the answer does not fit the brief's shape, and notes a served model that differs from the configured one or an effort the model ignored. Each of these logs a `warning:` line and shows on the brief as an amber warnings block under the header. The brief is still valid. OpenRouter learns at boot that a model has no reasoning support, so that gap logs once and shows as `effort: null` instead.

### Brief text runs long on a weaker model

The prompt caps the length of group titles and summaries, the revision narrative and risk notes, and asks each new brief to change as little of the previous one's text as it can. Strong models follow both; weaker ones overwrite. The pipeline never trims: over-long text shows as a muted line on the Changes view ("Some brief text is longer than the length guidance") and as `prose length` entries in the warnings block. If you see it persistently, use a stronger `model:`; no setting fixes it.
