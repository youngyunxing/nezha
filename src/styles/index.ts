import type React from "react";

import { common } from "./common";
import { dialogs } from "./dialogs";
import { font } from "./font";
import { gitDiff } from "./git-diff";
import { layout } from "./layout";
import { panels } from "./panels";
import { railActions } from "./rail-actions";
import { task } from "./task";
import { terminal } from "./terminal";

const s = {
  ...layout,
  ...panels,
  ...railActions,
  ...terminal,
  ...dialogs,
  ...task,
  ...gitDiff,
  ...common,
  ...font,
} satisfies Record<string, React.CSSProperties>;

export default s;

export { common, dialogs, font, gitDiff, layout, panels, railActions, task, terminal };
