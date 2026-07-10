import { describe, expect, it } from "vitest";
import type { MutableDaemonConfig } from "@getpaseo/protocol/messages";
import {
  createSessionAutosyncPatch,
  getSessionAutosyncCardState,
  getSessionAutosyncMutationViewState,
} from "./session-autosync-config";

function makeConfig(enabled: boolean): MutableDaemonConfig {
  return {
    sessionAutosync: {
      enabled,
      intervalSeconds: 60,
      providers: ["claude", "codex", "opencode"],
      maxImportsPerPass: 25,
    },
  } as unknown as MutableDaemonConfig;
}

describe("getSessionAutosyncCardState", () => {
  it("is hidden while the host is disconnected", () => {
    const state = getSessionAutosyncCardState({ isConnected: false, config: makeConfig(true) });
    expect(state.isVisible).toBe(false);
  });

  it("reflects the daemon's enabled flag", () => {
    expect(
      getSessionAutosyncCardState({ isConnected: true, config: makeConfig(true) }).isEnabled,
    ).toBe(true);
    expect(
      getSessionAutosyncCardState({ isConnected: true, config: makeConfig(false) }).isEnabled,
    ).toBe(false);
  });

  it("reads as disabled when the daemon has not sent the block yet", () => {
    const state = getSessionAutosyncCardState({ isConnected: true, config: null });
    expect(state.isVisible).toBe(true);
    expect(state.isEnabled).toBe(false);
  });
});

describe("createSessionAutosyncPatch", () => {
  it("patches only `enabled`, leaving interval and providers to the daemon", () => {
    expect(createSessionAutosyncPatch(true)).toEqual({ sessionAutosync: { enabled: true } });
    expect(createSessionAutosyncPatch(false)).toEqual({ sessionAutosync: { enabled: false } });
  });
});

describe("getSessionAutosyncMutationViewState", () => {
  it("disables the switch and shows progress while pending", () => {
    const view = getSessionAutosyncMutationViewState({ isPending: true, error: null });
    expect(view.isSwitchDisabled).toBe(true);
    expect(view.loadingText).toBe("Updating autosync…");
    expect(view.errorText).toBeNull();
  });

  it("surfaces the failure message when the patch fails", () => {
    const view = getSessionAutosyncMutationViewState({
      isPending: false,
      error: new Error("host disconnected"),
    });
    expect(view.isSwitchDisabled).toBe(false);
    expect(view.errorText).toBe("host disconnected");
  });
});
