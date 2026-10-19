#!/bin/sh
# One image, four words: `api`, `web`, `worker` start a service, `migrate`
# applies pending migrations and exits. Extra arguments pass through.
set -eu

word="${1:-}"
if [ $# -gt 0 ]; then
  shift
fi

case "$word" in
  api)
    cd /app/apps/api
    exec node --import tsx src/main.ts "$@"
    ;;
  worker)
    cd /app/apps/worker
    exec node --import tsx src/main.ts "$@"
    ;;
  migrate)
    cd /app/apps/api
    exec node --import tsx src/migrate.ts "$@"
    ;;
  web)
    cd /app/apps/web
    exec node --import tsx src/serve.ts "$@"
    ;;
  *)
    echo "usage: docker-entrypoint.sh api | web | worker | migrate" >&2
    exit 1
    ;;
esac
