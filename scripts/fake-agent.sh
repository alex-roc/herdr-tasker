#!/bin/sh
# A stand-in agent for demos and tests: draws a little screen and reports a status
# to Herdr with the Program Status Protocol (OSC 7501), as Claude Code does.
# Usage: fake-agent.sh <working|blocked|done|idle> [question or message] [app]
state=${1:-working} msg=${2:-} app=${3:-claude-code}
b64() { printf '%s' "$1" | base64 | tr -d '\n'; }
report() {
  if [ -n "$msg" ]; then printf '\033]7501;state=%s:app=%s:msg=%s\033\\' "$1" "$app" "$(b64 "$msg")"
  else printf '\033]7501;state=%s:app=%s\033\\' "$1" "$app"; fi
}
printf '\033]0;%s\007' "${TITLE:-demo agent}"
printf '\n  \033[1m%s\033[0m\n\n' "${TITLE:-demo agent}"
case $state in
  working) printf '  ● Reading src/auth/session.ts\n  ● Editing src/auth/login.tsx (+42 −7)\n  ● Running the tests…\n' ;;
  blocked) printf '  ● Read the schema and the two drafts\n\n  ? %s\n    1. Postgres   2. SQLite\n' "$msg" ;;
  done) printf '  ● Added the rate limiter and its tests\n  ✓ 18 tests passed\n\n  Done. Ready for review.\n' ;;
  *) printf '  ready\n' ;;
esac
# Keep saying it: hosts treat a long-silent report as stale.
while :; do report "$state"; sleep 5; done
