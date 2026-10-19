#!/usr/bin/env bash
# usage: image-boot-smoke.sh <image>
# Boots the image the way compose runs it: migrate, then api, web and worker
# against a throwaway Postgres on a private network. Container logs print only
# when a step fails. Runs in CI's image job and by hand.
set -euo pipefail
image="$1"
net="mb-smoke-$$"
work="$(mktemp -d)"
containers=()

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    for name in ${containers[@]+"${containers[@]}"}; do
      echo "::group::logs: $name"
      docker logs "$name" 2>&1 | tail -n 60 || true
      echo "::endgroup::"
    done
  fi
  for name in ${containers[@]+"${containers[@]}"}; do
    docker stop "$name" >/dev/null 2>&1 || true
    docker rm "$name" >/dev/null 2>&1 || true
  done
  docker network rm "$net" >/dev/null 2>&1 || true
  rm -r "$work"
  exit "$status"
}
trap cleanup EXIT

start() {
  local name="$1"
  shift
  containers+=("$name")
  docker run -d --name "$name" --network "$net" "$@" >/dev/null
}

wait_for() {
  local what="$1" tries="$2"
  shift 2
  for _ in $(seq "$tries"); do
    if "$@" >/dev/null 2>&1; then
      echo "$what: ready"
      return 0
    fi
    sleep 2
  done
  echo "::error::$what never became ready"
  return 1
}

docker network create "$net" >/dev/null
start pg-$$ -e POSTGRES_USER=smoke -e POSTGRES_PASSWORD=smoke -e POSTGRES_DB=smoke postgres:17-alpine
wait_for postgres 30 docker exec "pg-$$" pg_isready -h 127.0.0.1 -U smoke -d smoke

# Parse-only credentials: the smoke boots the processes, it never calls GitHub.
openssl genrsa -out "$work/app.pem" 2048 2>/dev/null
cat > "$work/env" <<EOF
DATABASE_URL=postgres://smoke:smoke@pg-$$:5432/smoke?sslmode=disable
GITHUB_APP_ID=1
GITHUB_WEBHOOK_SECRET=smoke-webhook-secret
GITHUB_OAUTH_CLIENT_ID=Iv1.smoke
GITHUB_OAUTH_CLIENT_SECRET=smoke-oauth-secret
SESSION_KEY_V1=$(openssl rand -base64 32)
PUBLIC_BASE_URL=http://localhost:3000
MERGEBRIEF_API_HOST=0.0.0.0
MERGEBRIEF_UPDATE_CHECK=false
ANTHROPIC_API_KEY=sk-ant-smoke-not-real
EOF
key="$(cat "$work/app.pem")"

docker run --rm --network "$net" --env-file "$work/env" -e GITHUB_APP_PRIVATE_KEY="$key" "$image" migrate

start api-$$ --env-file "$work/env" -e GITHUB_APP_PRIVATE_KEY="$key" "$image" api
start worker-$$ --env-file "$work/env" -e GITHUB_APP_PRIVATE_KEY="$key" "$image" worker
worker_started=$SECONDS
start web-$$ -p 127.0.0.1::3000 \
  -e PUBLIC_BASE_URL=http://localhost:3000 -e MERGEBRIEF_API_ORIGIN="http://api-$$:3001" \
  "$image" web
port="$(docker port "web-$$" 3000/tcp | head -n1 | sed 's/.*://')"

wait_for "web /healthz" 30 curl -fsS --max-time 5 "http://127.0.0.1:$port/healthz"
# /readyz asks the api's /readyz through the web tier, so it proves the hop.
wait_for "web /readyz" 30 curl -fsS --max-time 5 "http://127.0.0.1:$port/readyz"
# A signed-out page render runs the SSR bundle and its reads against the api.
curl -fsS --max-time 30 -o /dev/null -H "host: localhost:3000" "http://127.0.0.1:$port/"
echo "web /: rendered"

worker_left=$((10 - (SECONDS - worker_started)))
if [ "$worker_left" -gt 0 ]; then
  sleep "$worker_left"
fi
running="$(docker inspect -f '{{.State.Running}}' "worker-$$")"
if [ "$running" != "true" ]; then
  echo "::error::the worker exited after boot"
  exit 1
fi
echo "worker: still running after 10s"
