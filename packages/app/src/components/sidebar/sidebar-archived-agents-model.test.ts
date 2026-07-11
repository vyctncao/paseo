import { describe, expect, it } from "vitest";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { buildSidebarArchivedAgentGroups } from "./sidebar-archived-agents-model";

function archivedAgent(input: {
  id: string;
  serverId?: string;
  projectKey?: string;
  projectName?: string;
  lastActivityAt?: string;
}): AggregatedAgent {
  const serverId = input.serverId ?? "host-a";
  const projectKey = input.projectKey ?? "project-a";
  const projectName = input.projectName ?? "Project A";
  return {
    id: input.id,
    serverId,
    serverLabel: serverId,
    title: input.id,
    status: "idle",
    lastActivityAt: new Date(input.lastActivityAt ?? "2026-07-10T12:00:00.000Z"),
    cwd: `/repo/${projectKey}`,
    workspaceId: `workspace-${input.id}`,
    provider: "codex",
    requiresAttention: false,
    attentionReason: null,
    attentionTimestamp: null,
    archivedAt: new Date("2026-07-10T13:00:00.000Z"),
    createdAt: new Date("2026-07-10T11:00:00.000Z"),
    labels: {},
    projectPlacement: {
      projectKey,
      projectName,
      workspaceName: input.id,
      checkout: {
        cwd: `/repo/${projectKey}`,
        isGit: false,
        currentBranch: null,
        remoteUrl: null,
        worktreeRoot: null,
        isPaseoOwnedWorktree: false,
        mainRepoRoot: null,
      },
    },
  };
}

describe("buildSidebarArchivedAgentGroups", () => {
  it("groups archived tasks by project and applies host filters", () => {
    const groups = buildSidebarArchivedAgentGroups({
      agents: [archivedAgent({ id: "one" }), archivedAgent({ id: "two", serverId: "host-b" })],
      hostFilters: ["host-a"],
      expandedGroupKeys: new Set(),
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("Project A");
    expect(groups[0]?.agents.map((agent) => agent.id)).toEqual(["one"]);
  });

  it("collapses projects after five tasks and expands on demand", () => {
    const agents = Array.from({ length: 7 }, (_, index) =>
      archivedAgent({
        id: `task-${index}`,
        lastActivityAt: `2026-07-10T12:0${index}:00.000Z`,
      }),
    );

    const collapsed = buildSidebarArchivedAgentGroups({
      agents,
      hostFilters: [],
      expandedGroupKeys: new Set(),
    });
    expect(collapsed[0]?.visibleAgents).toHaveLength(5);
    expect(collapsed[0]?.hiddenCount).toBe(2);

    const expanded = buildSidebarArchivedAgentGroups({
      agents,
      hostFilters: [],
      expandedGroupKeys: new Set(["host-a:project-a"]),
    });
    expect(expanded[0]?.visibleAgents).toHaveLength(7);
    expect(expanded[0]?.hiddenCount).toBe(0);
  });
});
