#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p .implementation/cache
project="shopping-test-$(date +%s)-$$"
watcher=''
control="$PWD/.implementation/$project-network"
cleanup() { if [ -n "$watcher" ]; then kill "$watcher" 2>/dev/null || true; wait "$watcher" 2>/dev/null || true; fi; rm -rf "$control"; docker compose -p "$project" -f compose.test.yaml down --volumes --remove-orphans; }
trap cleanup EXIT INT TERM
case "${1:-service}" in
 service) docker compose -p "$project" -f compose.test.yaml run --rm service-tests ;;
 e2e) mkdir -p "$control"; sh scripts/network-control.sh "$project" "$control" & watcher=$!; docker compose -p "$project" -f compose.test.yaml run --build --rm -e ORIGIN_CONTROL_DIR="/app/.implementation/$project-network" e2e ;;
 *) echo 'usage: test-containers.sh service|e2e' >&2; exit 2 ;;
esac
