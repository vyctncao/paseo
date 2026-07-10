import type { MutableDaemonConfig, MutableDaemonConfigPatch } from "@getpaseo/protocol/messages";

export const SESSION_AUTOSYNC_TITLE = "Autosync CLI sessions";
export const SESSION_AUTOSYNC_HINT =
  "Automatically import Claude Code, Codex, and OpenCode sessions started in a terminal. Only sessions whose directory matches an existing workspace are imported; nothing new is created.";

export interface SessionAutosyncCardState {
  isVisible: boolean;
  isEnabled: boolean;
  title: string;
  hint: string;
}

export interface SessionAutosyncMutationViewState {
  isSwitchDisabled: boolean;
  loadingText: string | null;
  errorText: string | null;
}

export function getSessionAutosyncCardState(input: {
  isConnected: boolean;
  config: MutableDaemonConfig | null;
}): SessionAutosyncCardState {
  return {
    isVisible: input.isConnected,
    isEnabled: input.config?.sessionAutosync?.enabled === true,
    title: SESSION_AUTOSYNC_TITLE,
    hint: SESSION_AUTOSYNC_HINT,
  };
}

// Patch only `enabled`. Interval, provider allowlist, and the per-pass import cap
// keep whatever the daemon already has — the toggle owns one field, not the block.
export function createSessionAutosyncPatch(enabled: boolean): MutableDaemonConfigPatch {
  return { sessionAutosync: { enabled } };
}

export function getSessionAutosyncMutationViewState(input: {
  isPending: boolean;
  error: unknown;
}): SessionAutosyncMutationViewState {
  return {
    isSwitchDisabled: input.isPending,
    loadingText: input.isPending ? "Updating autosync…" : null,
    errorText: input.error ? toErrorMessage(input.error) : null,
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
