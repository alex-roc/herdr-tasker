#!/bin/sh
# Installs (or updates) tasker in the Herdr app's home: the layout, its picture,
# its theme and its mod. Copies, not links: Herdr only hot-reloads files saved
# inside its own folder.
#
# Usage: ./install.sh              install or update
#        ./install.sh --keys       also add tasker's shortcuts to keys.json (never replaces yours)
#        ./install.sh --uninstall  remove tasker (your tasks in data/tasker stay)
set -eu

SRC=$(cd "$(dirname "$0")" && pwd)
HOME_DIR=${HERDR_APP_HOME:-"$HOME/.config/herdr-app"}
KEYS=0
for arg in "$@"; do
  case $arg in
    --keys) KEYS=1 ;;
    --uninstall) MODE=uninstall ;;
    -h|--help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

if [ ! -d "$HOME_DIR" ]; then
  echo "No Herdr app home at $HOME_DIR (start Herdr once, or set HERDR_APP_HOME)." >&2
  exit 1
fi

if [ "${MODE:-}" = "uninstall" ]; then
  rm -rf "$HOME_DIR/mods/tasker" "$HOME_DIR/layouts/tasker.json" "$HOME_DIR/layouts/tasker.svg" "$HOME_DIR/themes/tasker.json"
  echo "tasker removed. Your tasks are still in $HOME_DIR/data/tasker/tasks.json."
  echo "Its shortcuts, if you added them, are the \"layout:tasker\" section of keys.json: harmless, or delete it."
  exit 0
fi

# A tasker that isn't this one (someone else's mod with the same name) is never overwritten.
if [ -e "$HOME_DIR/mods/tasker" ] && [ ! -L "$HOME_DIR/mods/tasker" ] && [ ! -f "$HOME_DIR/mods/tasker/.tasker" ]; then
  echo "$HOME_DIR/mods/tasker exists and isn't tasker: rename it first." >&2
  exit 1
fi

# Older installs linked these; replace links with copies.
for p in mods/tasker layouts/tasker.json themes/tasker.json; do
  if [ -L "$HOME_DIR/$p" ]; then rm "$HOME_DIR/$p"; fi
done

mkdir -p "$HOME_DIR/mods/tasker" "$HOME_DIR/layouts" "$HOME_DIR/themes"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete --exclude 'jsconfig.json' --exclude '*.d.ts' --exclude '.tasker' "$SRC/mods/tasker/" "$HOME_DIR/mods/tasker/"
else
  find "$HOME_DIR/mods/tasker" -mindepth 1 ! -name 'jsconfig.json' ! -name '*.d.ts' -exec rm -rf {} + 2>/dev/null || true
  cp -R "$SRC/mods/tasker/." "$HOME_DIR/mods/tasker/"
fi
touch "$HOME_DIR/mods/tasker/.tasker"
cp "$SRC/layouts/tasker.json" "$SRC/layouts/tasker.svg" "$HOME_DIR/layouts/"
cp "$SRC/themes/tasker.json" "$HOME_DIR/themes/tasker.json"

# Shortcuts: tasker's "layout:tasker" keys are added; a key you already bound there stays yours.
if [ "$KEYS" = 1 ]; then
  MERGE='
    const fs = require("fs");
    const [mine, theirs] = process.argv.slice(1);
    const add = JSON.parse(fs.readFileSync(theirs, "utf8"));
    const keys = fs.existsSync(mine) ? JSON.parse(fs.readFileSync(mine, "utf8")) : {};
    const kept = [];
    for (const [section, map] of Object.entries(add)) {
      keys[section] ??= {};
      for (const [k, v] of Object.entries(map)) {
        if (keys[section][k] && keys[section][k] !== v) kept.push(`${section} ${k} (${keys[section][k]})`);
        else keys[section][k] = v;
      }
    }
    fs.writeFileSync(mine, JSON.stringify(keys, null, 2) + "\n");
    console.log(kept.length ? `Kept your own: ${kept.join(", ")}` : "Shortcuts added.");'
  if command -v node >/dev/null 2>&1; then
    node -e "$MERGE" "$HOME_DIR/keys.json" "$SRC/keys.json"
  else
    echo "Adding shortcuts needs node: merge $SRC/keys.json into $HOME_DIR/keys.json by hand." >&2
  fi
fi

if command -v herdr-app >/dev/null 2>&1; then
  herdr-app check "$HOME_DIR/mods/tasker"
fi
echo "tasker installed. Pick it in Settings → Look, or: herdr-app do layout.switch '{\"name\":\"tasker\"}'"
