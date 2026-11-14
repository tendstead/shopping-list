#!/bin/sh
# Test-only origin disconnection: bypass WebKit's known offline-emulation bug.
set -eu
project=$1
control=$2
last=''
while :; do
  if [ -f "$control/request" ]; then
    phase=$(cat "$control/request")
    # A request writer can truncate the file before its next value is visible.
    # Keep watching instead of exiting between the Chromium and WebKit runs.
    case "$phase" in
      offline|online) ;;
      '') sleep 0.1; continue ;;
      *) echo "invalid origin control request: $phase" >&2; exit 2 ;;
    esac
    if [ "$phase" != "$last" ]; then
      tls=$(docker compose -p "$project" -f compose.test.yaml ps -a -q tls)
      case "$phase" in
        offline) docker stop --time 0 "$tls" >/dev/null ;;
        online) docker start "$tls" >/dev/null ;;
        *) exit 2 ;;
      esac
      last=$phase
      echo "$phase" > "$control/ack.tmp"
      mv "$control/ack.tmp" "$control/ack"
    fi
  fi
  sleep 0.1
done
