#!/bin/sh
# Runs Herdr's own `herdr-app check` on the mod once per role and dialog.
# `check` renders a mod with no props; tasker draws something different for each
# { role } and { dialog }, so each gets a copy whose props() returns that one.
# Usage: scripts/check.sh   (needs herdr-app on PATH)
set -eu

SRC=$(cd "$(dirname "$0")/.." && pwd)/mods/tasker
command -v herdr-app >/dev/null 2>&1 || { echo "herdr-app not found: install Herdr first." >&2; exit 1; }
WORK=$(mktemp -d "${TMPDIR:-/tmp}/tasker-check.XXXXXX")
trap 'rm -rf "$WORK"' EXIT

fail=0
check() {
  label=$1 json=$2
  dir="$WORK/$label"
  rm -rf "$dir" && cp -R "$SRC" "$dir"
  for f in "$dir/main.js" "$dir/dialogs.js"; do
    # props() → this case's props; the import of props stays harmless.
    perl -pi -e 's/\bprops\(\)/__checkProps()/g' "$f"
    printf 'const __checkProps = () => (%s);\n' "$json" >> "$f"
  done
  if out=$(herdr-app check "$dir" 2>&1); then
    echo "ok    $label"
  else
    echo "FAIL  $label"; echo "$out" | sed 's/^/      /' | head -12; fail=1
  fi
}

check plain '{}'
for role in sidebar detail status board; do check "role-$role" "{\"role\":\"$role\"}"; done
for d in task project menu repo jump issues archive confirm-delete settings; do
  check "dialog-$d" "{\"dialog\":\"$d\",\"overlay\":\"ov\",\"repo\":\"~\"}"
done
exit $fail
