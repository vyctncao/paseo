import { describe, expect, it, vi } from "vitest";

import {
  shouldRenderCollapsedSidebarToggle,
  toggleDesktopSidebarsWithCheckoutIntent,
} from "./desktop-sidebar-toggle";

describe("shouldRenderCollapsedSidebarToggle", () => {
  const base = {
    isCompact: false,
    chromeEnabled: true,
    focusModeEnabled: false,
    isAgentListOpen: false,
  };

  it("renders the floating toggle when the desktop sidebar is collapsed", () => {
    expect(shouldRenderCollapsedSidebarToggle(base)).toBe(true);
  });

  it("does not render the floating toggle while the sidebar is open", () => {
    expect(shouldRenderCollapsedSidebarToggle({ ...base, isAgentListOpen: true })).toBe(false);
  });

  it("leaves compact layouts to the toggle in their screen header", () => {
    expect(shouldRenderCollapsedSidebarToggle({ ...base, isCompact: true })).toBe(false);
  });

  it("stays hidden when chrome is disabled or focus mode owns the window", () => {
    expect(shouldRenderCollapsedSidebarToggle({ ...base, chromeEnabled: false })).toBe(false);
    expect(shouldRenderCollapsedSidebarToggle({ ...base, focusModeEnabled: true })).toBe(false);
  });
});

describe("toggleDesktopSidebarsWithCheckoutIntent", () => {
  it("closes both sidebars when either desktop sidebar is open", () => {
    const openAgentList = vi.fn();
    const closeAgentList = vi.fn();
    const closeFileExplorer = vi.fn();
    const toggleFocusedFileExplorer = vi.fn(() => true);

    const handled = toggleDesktopSidebarsWithCheckoutIntent({
      isAgentListOpen: true,
      isFileExplorerOpen: false,
      openAgentList,
      closeAgentList,
      closeFileExplorer,
      toggleFocusedFileExplorer,
    });

    expect(handled).toBe(true);
    expect(closeAgentList).toHaveBeenCalledTimes(1);
    expect(closeFileExplorer).toHaveBeenCalledTimes(1);
    expect(openAgentList).not.toHaveBeenCalled();
    expect(toggleFocusedFileExplorer).not.toHaveBeenCalled();
  });

  it("opens the right sidebar only through the focused checkout-aware handler", () => {
    const openAgentList = vi.fn();
    const closeAgentList = vi.fn();
    const closeFileExplorer = vi.fn();
    const toggleFocusedFileExplorer = vi.fn(() => false);

    const handled = toggleDesktopSidebarsWithCheckoutIntent({
      isAgentListOpen: false,
      isFileExplorerOpen: false,
      openAgentList,
      closeAgentList,
      closeFileExplorer,
      toggleFocusedFileExplorer,
    });

    expect(handled).toBe(true);
    expect(openAgentList).toHaveBeenCalledTimes(1);
    expect(toggleFocusedFileExplorer).toHaveBeenCalledTimes(1);
    expect(closeAgentList).not.toHaveBeenCalled();
    expect(closeFileExplorer).not.toHaveBeenCalled();
  });
});
