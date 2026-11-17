import type { SplitNode, SplitPane } from "@/stores/workspace-layout-store";

function collectPanes(node: SplitNode): SplitPane[] {
  if (node.kind === "pane") {
    return [node.pane];
  }
  return node.group.children.flatMap(collectPanes);
}

/**
 * The primary workspace pane already has the workspace header, so its tab strip
 * stays hidden until it actually contains multiple tabs. Secondary panes always
 * show their strip so the user can add and switch chat, browser, or terminal tabs.
 */
export function getWorkspacePaneTabStripIds(root: SplitNode): Set<string> {
  const panes = collectPanes(root);
  const hasMultiplePanes = panes.length > 1;

  return new Set(
    panes
      .filter((pane, index) => pane.tabIds.length > 1 || (hasMultiplePanes && index > 0))
      .map((pane) => pane.id),
  );
}
