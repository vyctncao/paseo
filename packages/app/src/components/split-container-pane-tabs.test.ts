import { describe, expect, it } from "vitest";
import { getWorkspacePaneTabStripIds } from "@/components/split-container-pane-tabs";
import type { SplitNode } from "@/stores/workspace-layout-store";

function pane(id: string, tabIds: string[]): SplitNode {
  return {
    kind: "pane",
    pane: {
      id,
      tabIds,
      focusedTabId: tabIds[0] ?? null,
    },
  };
}

function split(children: SplitNode[]): SplitNode {
  return {
    kind: "group",
    group: {
      id: "root",
      direction: "horizontal",
      children,
      sizes: children.map(() => 1 / children.length),
    },
  };
}

describe("getWorkspacePaneTabStripIds", () => {
  it("keeps a single primary tab visually quiet", () => {
    expect([...getWorkspacePaneTabStripIds(pane("main", ["chat"]))]).toEqual([]);
  });

  it("shows the primary strip when another tab opens in it", () => {
    expect([...getWorkspacePaneTabStripIds(pane("main", ["chat", "terminal"]))]).toEqual(["main"]);
  });

  it("shows a secondary pane strip as soon as the pane opens", () => {
    expect([
      ...getWorkspacePaneTabStripIds(split([pane("main", ["chat"]), pane("side", ["browser"])])),
    ]).toEqual(["side"]);
  });

  it("also shows the primary strip when it contains multiple tabs", () => {
    expect([
      ...getWorkspacePaneTabStripIds(
        split([pane("main", ["chat", "terminal"]), pane("side", ["browser"])]),
      ),
    ]).toEqual(["main", "side"]);
  });
});
