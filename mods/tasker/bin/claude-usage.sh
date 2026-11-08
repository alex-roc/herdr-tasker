#!/bin/sh
# Prints Claude Code's plan usage as one JSON line, then exits.
#
# Starts your own `claude` CLI for a moment in its streaming mode and asks it
# for usage with a `get_usage` control request: the CLI signs in by itself, so
# this reads no token or credential file. It sends no prompt and starts no turn
# (no model time), keeps no session, and --safe-mode leaves hooks, MCP servers
# and plugins out.
#
# Exit 0: printed the reply. 127: no claude CLI. 1: no reply within 15 s.
CLAUDE=$(command -v "${TASKER_CLAUDE_BIN:-claude}" 2>/dev/null) || exit 127

dir=$(mktemp -d "${TMPDIR:-/tmp}/tasker-usage.XXXXXX") || exit 1
trap 'rm -rf "$dir"' EXIT
mkfifo "$dir/in" || exit 1

"$CLAUDE" -p --safe-mode --no-session-persistence \
  --input-format stream-json --output-format stream-json --verbose \
  <"$dir/in" >"$dir/out" 2>/dev/null &
pid=$!
exec 3>"$dir/in"
printf '%s\n' '{"type":"control_request","request_id":"tasker-usage","request":{"subtype":"get_usage","skip_behaviors":true}}' >&3

i=0
while [ "$i" -lt 75 ] && ! grep -q '"control_response"' "$dir/out" 2>/dev/null && kill -0 "$pid" 2>/dev/null; do
  sleep 0.2
  i=$((i + 1))
done
exec 3>&-
kill "$pid" 2>/dev/null
wait "$pid" 2>/dev/null
grep -m1 '"control_response"' "$dir/out"
