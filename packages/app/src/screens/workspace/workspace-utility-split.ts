export type WorkspaceUtilitySplitPosition = "right" | "bottom";

interface OpenWorkspaceUtilitySplitInput {
  workspaceKey: string | null;
  targetPaneId: string | null;
  position: WorkspaceUtilitySplitPosition;
  splitPaneEmpty: (
    workspaceKey: string,
    input: {
      targetPaneId: string;
      position: WorkspaceUtilitySplitPosition;
    },
  ) => string | null;
  openInPane: (paneId?: string) => void;
}

/**
 * Utility surfaces own panes instead of joining the active chat's hidden tab
 * stack. If the layout cannot split (for example at the depth limit), opening
 * in the focused pane preserves the action instead of silently doing nothing.
 */
export function openWorkspaceUtilitySplit({
  workspaceKey,
  targetPaneId,
  position,
  splitPaneEmpty,
  openInPane,
}: OpenWorkspaceUtilitySplitInput): string | null {
  if (!workspaceKey || !targetPaneId) {
    openInPane();
    return null;
  }

  const paneId = splitPaneEmpty(workspaceKey, { targetPaneId, position });
  if (!paneId) {
    openInPane();
    return null;
  }

  openInPane(paneId);
  return paneId;
}
