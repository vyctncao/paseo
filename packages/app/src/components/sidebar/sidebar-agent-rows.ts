import type { AgentPetLifecycle } from "@/components/pet/pet-sprite";

/**
 * Groups a workspace's open chats into the rows the sidebar renders beneath their
 * branch. A lone chat is omitted because the workspace row already opens it; nested
 * rows are only needed when there are multiple chats to switch between.
 *
 * This is deliberately a pure projection over data the workspace already has. Row
 * activation calls the layout store's existing `focusTab`, the same action the tab
 * strip used, so selecting a chat changes no route. Per docs/expo-router.md, route
 * ownership is where this area fails (silently, with a blank native screen), so the
 * refactor stays out of `packages/app/src/app` entirely.
 */

export interface SidebarAgentRowInput {
  tabId: string;
  agentId: string;
  /** Chat title, e.g. "do you remember the glyka repo i sent?". */
  title: string;
  /** Directory the chat runs in; rendered as the row's secondary text. */
  cwd: string;
  lifecycle: AgentPetLifecycle;
  /** Ordering key; newer chats sort first within a branch. */
  lastActivityAtMs: number;
}

export interface SidebarWorkspaceGroupInput {
  workspaceId: string;
  /** Branch name for a worktree; null for a plain directory workspace. */
  branch: string | null;
  displayName: string;
  agents: SidebarAgentRowInput[];
}

export interface SidebarAgentRow extends SidebarAgentRowInput {
  /** Trailing path segment of `cwd`, which is what the row shows. */
  folder: string;
  isActive: boolean;
}

export interface SidebarWorkspaceGroup {
  workspaceId: string;
  /** Branch when present, else the workspace's display name. */
  label: string;
  isCollapsed: boolean;
  /** Empty when collapsed or when the workspace has only one chat. */
  rows: SidebarAgentRow[];
  /** Always the true count, even while collapsed. */
  agentCount: number;
  /** Any chat in the group needing attention, so a collapsed group can still signal. */
  hasAttention: boolean;
}

export function folderLabel(cwd: string): string {
  const segments = cwd.split(/[\\/]/).filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? cwd;
}

/** `needs_input` and `error` are the states a collapsed group must not hide. */
export function lifecycleNeedsAttention(lifecycle: AgentPetLifecycle): boolean {
  return lifecycle === "needs_input" || lifecycle === "error";
}

function toSidebarAgentRow(
  agent: SidebarAgentRowInput,
  activeTabId: string | null,
): SidebarAgentRow {
  return {
    tabId: agent.tabId,
    agentId: agent.agentId,
    title: agent.title,
    cwd: agent.cwd,
    lifecycle: agent.lifecycle,
    lastActivityAtMs: agent.lastActivityAtMs,
    folder: folderLabel(agent.cwd),
    isActive: agent.tabId === activeTabId,
  };
}

export function buildSidebarWorkspaceGroup(input: {
  workspace: SidebarWorkspaceGroupInput;
  activeTabId: string | null;
  collapsedWorkspaceIds: ReadonlySet<string>;
  /** Project-level chat lists have no workspace row to represent a lone remaining chat. */
  showLoneChat?: boolean;
}): SidebarWorkspaceGroup {
  const { workspace, activeTabId, collapsedWorkspaceIds, showLoneChat = false } = input;
  const isCollapsed = collapsedWorkspaceIds.has(workspace.workspaceId);

  const sorted = [...workspace.agents].sort((left, right) => {
    if (right.lastActivityAtMs !== left.lastActivityAtMs) {
      return right.lastActivityAtMs - left.lastActivityAtMs;
    }
    return left.tabId.localeCompare(right.tabId);
  });

  return {
    workspaceId: workspace.workspaceId,
    label: workspace.branch ?? workspace.displayName,
    isCollapsed,
    rows:
      isCollapsed || (!showLoneChat && sorted.length <= 1)
        ? []
        : sorted.map((agent) => toSidebarAgentRow(agent, activeTabId)),
    agentCount: workspace.agents.length,
    hasAttention: workspace.agents.some((agent) => lifecycleNeedsAttention(agent.lifecycle)),
  };
}

export function buildSidebarWorkspaceGroups(input: {
  workspaces: SidebarWorkspaceGroupInput[];
  activeTabId: string | null;
  collapsedWorkspaceIds: ReadonlySet<string>;
}): SidebarWorkspaceGroup[] {
  return input.workspaces.map((workspace) =>
    buildSidebarWorkspaceGroup({
      workspace,
      activeTabId: input.activeTabId,
      collapsedWorkspaceIds: input.collapsedWorkspaceIds,
    }),
  );
}

/**
 * Expanding the group holding the active chat keeps the selection visible. A chat
 * activated from elsewhere (a keyboard shortcut, a deep link) would otherwise land
 * inside a collapsed group with nothing on screen to show for it.
 */
export function collapsedIdsRevealingActiveTab(input: {
  workspaces: SidebarWorkspaceGroupInput[];
  activeTabId: string | null;
  collapsedWorkspaceIds: ReadonlySet<string>;
}): Set<string> {
  const next = new Set(input.collapsedWorkspaceIds);
  if (!input.activeTabId) return next;

  const owner = input.workspaces.find((workspace) =>
    workspace.agents.some((agent) => agent.tabId === input.activeTabId),
  );
  if (owner) next.delete(owner.workspaceId);
  return next;
}
