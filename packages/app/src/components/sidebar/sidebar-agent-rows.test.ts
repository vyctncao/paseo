import { describe, expect, it } from "vitest";
import {
  buildSidebarWorkspaceGroup,
  buildSidebarWorkspaceGroups,
  collapsedIdsRevealingActiveTab,
  folderLabel,
  lifecycleNeedsAttention,
  type SidebarWorkspaceGroupInput,
} from "./sidebar-agent-rows";

function agent(
  tabId: string,
  overrides: Partial<SidebarWorkspaceGroupInput["agents"][number]> = {},
) {
  return {
    tabId,
    agentId: `agent-${tabId}`,
    title: `chat ${tabId}`,
    cwd: "/Users/v/Stratton-internal",
    lifecycle: "idle" as const,
    lastActivityAtMs: 0,
    ...overrides,
  };
}

const workspace: SidebarWorkspaceGroupInput = {
  workspaceId: "ws-1",
  branch: "staging",
  displayName: "stratton-internal",
  agents: [agent("a"), agent("b")],
};

describe("folderLabel", () => {
  it("shows the trailing directory segment", () => {
    expect(folderLabel("/Users/v/Stratton-internal")).toBe("Stratton-internal");
    expect(folderLabel("/Users/v/Stratton-internal/")).toBe("Stratton-internal");
    expect(folderLabel("C:\\code\\paseo")).toBe("paseo");
  });

  it("falls back to the input when there is no segment", () => {
    expect(folderLabel("/")).toBe("/");
  });
});

describe("lifecycleNeedsAttention", () => {
  it("flags only the states a collapsed group must not hide", () => {
    expect(lifecycleNeedsAttention("needs_input")).toBe(true);
    expect(lifecycleNeedsAttention("error")).toBe(true);
    expect(lifecycleNeedsAttention("running")).toBe(false);
    expect(lifecycleNeedsAttention("completed")).toBe(false);
  });
});

describe("buildSidebarWorkspaceGroup", () => {
  it("labels the group with the branch, falling back to the display name", () => {
    const group = buildSidebarWorkspaceGroup({
      workspace,
      activeTabId: null,
      collapsedWorkspaceIds: new Set(),
    });
    expect(group.label).toBe("staging");

    const directory = buildSidebarWorkspaceGroup({
      workspace: { ...workspace, branch: null },
      activeTabId: null,
      collapsedWorkspaceIds: new Set(),
    });
    expect(directory.label).toBe("stratton-internal");
  });

  it("renders a row per chat with its folder and active flag", () => {
    const group = buildSidebarWorkspaceGroup({
      workspace,
      activeTabId: "b",
      collapsedWorkspaceIds: new Set(),
    });

    expect(group.rows.map((row) => row.tabId)).toEqual(["a", "b"]);
    expect(group.rows.every((row) => row.folder === "Stratton-internal")).toBe(true);
    expect(group.rows.find((row) => row.tabId === "b")?.isActive).toBe(true);
    expect(group.rows.find((row) => row.tabId === "a")?.isActive).toBe(false);
  });

  it("sorts newer chats first, breaking ties by tabId", () => {
    const group = buildSidebarWorkspaceGroup({
      workspace: {
        ...workspace,
        agents: [
          agent("old", { lastActivityAtMs: 10 }),
          agent("new", { lastActivityAtMs: 30 }),
          agent("mid", { lastActivityAtMs: 20 }),
        ],
      },
      activeTabId: null,
      collapsedWorkspaceIds: new Set(),
    });

    expect(group.rows.map((row) => row.tabId)).toEqual(["new", "mid", "old"]);
  });

  it("emits no rows when collapsed but still reports the true count", () => {
    const group = buildSidebarWorkspaceGroup({
      workspace,
      activeTabId: null,
      collapsedWorkspaceIds: new Set(["ws-1"]),
    });

    expect(group.isCollapsed).toBe(true);
    expect(group.rows).toEqual([]);
    expect(group.agentCount).toBe(2);
  });

  it("surfaces attention from a collapsed group so it is never hidden", () => {
    const group = buildSidebarWorkspaceGroup({
      workspace: { ...workspace, agents: [agent("a"), agent("b", { lifecycle: "needs_input" })] },
      activeTabId: null,
      collapsedWorkspaceIds: new Set(["ws-1"]),
    });

    expect(group.rows).toEqual([]);
    expect(group.hasAttention).toBe(true);
  });
});

describe("buildSidebarWorkspaceGroups", () => {
  it("projects every workspace", () => {
    const groups = buildSidebarWorkspaceGroups({
      workspaces: [workspace, { ...workspace, workspaceId: "ws-2", branch: "main" }],
      activeTabId: null,
      collapsedWorkspaceIds: new Set(["ws-2"]),
    });

    expect(groups.map((group) => group.label)).toEqual(["staging", "main"]);
    expect(groups[1]!.isCollapsed).toBe(true);
  });
});

describe("collapsedIdsRevealingActiveTab", () => {
  it("expands the group that owns the active chat", () => {
    const next = collapsedIdsRevealingActiveTab({
      workspaces: [workspace],
      activeTabId: "b",
      collapsedWorkspaceIds: new Set(["ws-1"]),
    });
    expect(next.has("ws-1")).toBe(false);
  });

  it("leaves other groups collapsed", () => {
    const next = collapsedIdsRevealingActiveTab({
      workspaces: [workspace, { ...workspace, workspaceId: "ws-2", agents: [] }],
      activeTabId: "b",
      collapsedWorkspaceIds: new Set(["ws-1", "ws-2"]),
    });
    expect(next.has("ws-1")).toBe(false);
    expect(next.has("ws-2")).toBe(true);
  });

  it("is a no-op with no active chat", () => {
    const next = collapsedIdsRevealingActiveTab({
      workspaces: [workspace],
      activeTabId: null,
      collapsedWorkspaceIds: new Set(["ws-1"]),
    });
    expect(next.has("ws-1")).toBe(true);
  });
});
