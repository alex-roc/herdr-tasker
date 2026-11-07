// tasker's dialogs and popups are this mod opened as an overlay with { dialog, ... }.
// Their sizes live here, so every place that opens one opens the same.

import { openOverlay } from "herdr";

const SIZES = {
  task: { kind: "dialog", width: 560, height: 660 },
  project: { kind: "dialog", width: 480, height: 500 },
  jump: { kind: "dialog", width: 520, height: 420 },
  issues: { kind: "dialog", width: 540, height: 460 },
  archive: { kind: "dialog", width: 460, height: 230 },
  "confirm-delete": { kind: "dialog", width: 420, height: 190 },
  settings: { kind: "dialog", width: 460, height: 440 },
  menu: { kind: "popup", width: 250, height: 290 },
  repo: { kind: "popup", width: 250, height: 340 },
};

export function openDialog(dialog, props = {}) {
  return openOverlay({ mod: "tasker", ...SIZES[dialog], props: { dialog, ...props } });
}
