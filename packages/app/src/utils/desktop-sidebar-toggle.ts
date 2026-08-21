interface DesktopSidebarToggleInput {
  isAgentListOpen: boolean;
  isFileExplorerOpen: boolean;
  openAgentList: () => void;
  closeAgentList: () => void;
  closeFileExplorer: () => void;
  toggleFocusedFileExplorer: () => boolean;
}

interface CollapsedSidebarToggleVisibilityInput {
  isCompact: boolean;
  chromeEnabled: boolean;
  focusModeEnabled: boolean;
  isAgentListOpen: boolean;
}

/**
 * The floating un-collapse affordance only exists while the desktop sidebar that
 * normally hosts the toggle is collapsed. Compact layouts keep their toggle in the
 * screen header, and focus mode deliberately hides all chrome.
 */
export function shouldRenderCollapsedSidebarToggle(
  input: CollapsedSidebarToggleVisibilityInput,
): boolean {
  if (input.isCompact || !input.chromeEnabled || input.focusModeEnabled) {
    return false;
  }

  return !input.isAgentListOpen;
}

export function toggleDesktopSidebarsWithCheckoutIntent(input: DesktopSidebarToggleInput): boolean {
  if (input.isAgentListOpen || input.isFileExplorerOpen) {
    input.closeAgentList();
    input.closeFileExplorer();
    return true;
  }

  input.openAgentList();
  input.toggleFocusedFileExplorer();
  return true;
}
