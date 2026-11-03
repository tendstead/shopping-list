#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
project="shopping-observe-$(date +%s)-$$"
compose() { docker compose -p "$project" -f compose.test.yaml -f tests/compose.observe.yaml "$@"; }
probe="$project-probe"
cleanup() { docker rm -f "$probe" >/dev/null 2>&1 || true; compose down --volumes --remove-orphans; }
trap cleanup EXIT INT TERM
compose up -d --build --wait app
app=$(compose ps -q app)
observe() { echo "$1"; docker stats --no-stream --format 'memory={{.MemUsage}} cpu={{.CPUPerc}}' "$app"; docker inspect --format 'oom={{.State.OOMKilled}} restarts={{.RestartCount}} memory_limit={{.HostConfig.Memory}} nanocpus={{.HostConfig.NanoCpus}}' "$app"; }
observe 'No clients'
docker run -d --cpus 0.5 --memory 128m --memory-swap 128m --name "$probe" --network "${project}_default" -v "$PWD/scripts/resource-probe.mjs:/probe.mjs:ro" node:24-alpine node /probe.mjs >/dev/null
sleep 4
observe 'Two idle SSE clients'
sleep 12
observe 'Editing and reconnecting'
code=$(docker wait "$probe")
docker logs "$probe"
if [ "$code" != 0 ]; then exit "$code"; fi
observe 'After editing'
compose stop app
docker inspect --format 'graceful_exit={{.State.ExitCode}} oom={{.State.OOMKilled}} restarts={{.RestartCount}}' "$app"
