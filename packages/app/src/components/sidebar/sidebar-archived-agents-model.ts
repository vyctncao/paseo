import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";

export const COLLAPSED_ARCHIVED_AGENT_COUNT = 5;

export interface SidebarArchivedAgentGroup {
  key: string;
  label: string;
  agents: AggregatedAgent[];
  visibleAgents: AggregatedAgent[];
  hiddenCount: number;
  expanded: boolean;
}

function fallbackProjectName(agent: AggregatedAgent): string {
  const segments = agent.cwd.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? "Other";
}

export function buildSidebarArchivedAgentGroups(input: {
  agents: readonly AggregatedAgent[];
  hostFilters: readonly string[];
  expandedGroupKeys: ReadonlySet<string>;
}): SidebarArchivedAgentGroup[] {
  const allowedHosts = input.hostFilters.length > 0 ? new Set(input.hostFilters) : null;
  const grouped = new Map<string, { label: string; agents: AggregatedAgent[] }>();

  for (const agent of input.agents) {
    if (!agent.archivedAt || (allowedHosts && !allowedHosts.has(agent.serverId))) continue;
    const placement = agent.projectPlacement;
    const projectKey = placement?.projectKey?.trim() || fallbackProjectName(agent);
    const label = placement?.projectName?.trim() || fallbackProjectName(agent);
    const key = `${agent.serverId}:${projectKey}`;
    const existing = grouped.get(key) ?? { label, agents: [] };
    existing.agents.push(agent);
    grouped.set(key, existing);
  }

  return Array.from(grouped, ([key, group]) => {
    const agents = [...group.agents].sort(
      (left, right) => right.lastActivityAt.getTime() - left.lastActivityAt.getTime(),
    );
    const expanded = input.expandedGroupKeys.has(key);
    const visibleAgents = expanded ? agents : agents.slice(0, COLLAPSED_ARCHIVED_AGENT_COUNT);
    return {
      key,
      label: group.label,
      agents,
      visibleAgents,
      hiddenCount: Math.max(0, agents.length - visibleAgents.length),
      expanded,
    };
  }).sort((left, right) => {
    const activityDelta =
      (right.agents[0]?.lastActivityAt.getTime() ?? 0) -
      (left.agents[0]?.lastActivityAt.getTime() ?? 0);
    return activityDelta || left.label.localeCompare(right.label);
  });
}
