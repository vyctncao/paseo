import { describe, expect, it, vi } from "vitest";
import { openWorkspaceUtilitySplit } from "@/screens/workspace/workspace-utility-split";

describe("openWorkspaceUtilitySplit", () => {
  it("opens the utility in a newly split pane", () => {
    const splitPaneEmpty = vi.fn(() => "utility-pane");
    const openInPane = vi.fn();

    const paneId = openWorkspaceUtilitySplit({
      workspaceKey: "host:workspace",
      targetPaneId: "main",
      position: "right",
      splitPaneEmpty,
      openInPane,
    });

    expect(paneId).toBe("utility-pane");
    expect(splitPaneEmpty).toHaveBeenCalledWith("host:workspace", {
      targetPaneId: "main",
      position: "right",
    });
    expect(openInPane).toHaveBeenCalledWith("utility-pane");
  });

  it("falls back to the focused pane when splitting is unavailable", () => {
    const splitPaneEmpty = vi.fn(() => null);
    const openInPane = vi.fn();

    const paneId = openWorkspaceUtilitySplit({
      workspaceKey: "host:workspace",
      targetPaneId: "main",
      position: "bottom",
      splitPaneEmpty,
      openInPane,
    });

    expect(paneId).toBeNull();
    expect(openInPane).toHaveBeenCalledWith();
  });

  it("does not replace the focused pane when fallback is disabled", () => {
    const splitPaneEmpty = vi.fn(() => null);
    const openInPane = vi.fn();

    const paneId = openWorkspaceUtilitySplit({
      workspaceKey: "host:workspace",
      targetPaneId: "main",
      position: "right",
      fallbackToFocusedPane: false,
      splitPaneEmpty,
      openInPane,
    });

    expect(paneId).toBeNull();
    expect(openInPane).not.toHaveBeenCalled();
  });

  it("does not open in the focused pane without a split target when fallback is disabled", () => {
    const splitPaneEmpty = vi.fn(() => "utility-pane");
    const openInPane = vi.fn();

    const paneId = openWorkspaceUtilitySplit({
      workspaceKey: "host:workspace",
      targetPaneId: null,
      position: "right",
      fallbackToFocusedPane: false,
      splitPaneEmpty,
      openInPane,
    });

    expect(paneId).toBeNull();
    expect(splitPaneEmpty).not.toHaveBeenCalled();
    expect(openInPane).not.toHaveBeenCalled();
  });
});
