import { describe, expect, it } from "vitest";
import { shouldShowAgentContextPanel } from "./agent-context-panel-visibility";

describe("shouldShowAgentContextPanel", () => {
  it("shows the context panel for a wide single-pane web workspace", () => {
    expect(
      shouldShowAgentContextPanel({
        isWeb: true,
        isBelowBreakpoint: false,
        paneCount: 1,
      }),
    ).toBe(true);
  });

  it("hides the context panel when the workspace is split", () => {
    expect(
      shouldShowAgentContextPanel({
        isWeb: true,
        isBelowBreakpoint: false,
        paneCount: 2,
      }),
    ).toBe(false);
  });

  it("keeps the existing compact and native behavior", () => {
    expect(
      shouldShowAgentContextPanel({
        isWeb: true,
        isBelowBreakpoint: true,
        paneCount: 1,
      }),
    ).toBe(false);
    expect(
      shouldShowAgentContextPanel({
        isWeb: false,
        isBelowBreakpoint: false,
        paneCount: 1,
      }),
    ).toBe(false);
  });
});
