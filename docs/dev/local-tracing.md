# Local tracing

`docker-compose.tracing.yml` runs a throwaway Jaeger for a checkout: the trace
viewer on `127.0.0.1:16686` and an OTLP/HTTP receiver on `4318`. It keeps
traces in memory, so a restart clears them. It is a development aid and not
part of a release: a production instance sends traces to its own backend
([observability.md](../self-host/observability.md#tracing)).

With the compose stack, set `OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318`
in `.env` and merge the file in:

```sh
docker compose -f docker-compose.yml -f docker-compose.tracing.yml up -d --wait
```

With the processes on the host (`pnpm app:host`), set
`OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318` and run it alone:

```sh
docker compose -f docker-compose.tracing.yml up -d
```

`vite dev` is untraced. The web tier traces only from `src/serve.ts`.
