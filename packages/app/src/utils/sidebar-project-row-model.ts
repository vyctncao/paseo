import type {
  SidebarProjectEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import { STANDALONE_TASKS_PROJECT_ID } from "@getpaseo/protocol/messages";

export interface SidebarProjectHostTarget {
  serverId: string;
  iconWorkingDir: string;
}

export type SidebarProjectTrailingAction =
  | { kind: "new_workspace"; target: SidebarProjectHostTarget }
  | { kind: "none" };

export interface SidebarProjectSectionRowModel {
  kind: "project_section";
  chevron: "expand" | "collapse";
  trailingAction: SidebarProjectTrailingAction;
}

export type SidebarProjectRowModel = SidebarProjectSectionRowModel;

export type SidebarProjectChildrenModel =
  | { kind: "direct_chats"; workspace: SidebarWorkspacePlacement }
  | { kind: "workspace_rows" };

const EMPTY_MULTIPLICITY_MAP: ReadonlyMap<string, boolean> = new Map();

export function splitStandaloneTasksFromProjects(projects: readonly SidebarProjectEntry[]): {
  projects: SidebarProjectEntry[];
  taskWorkspaces: SidebarWorkspacePlacement[];
} {
  const visibleProjects: SidebarProjectEntry[] = [];
  const taskWorkspaces: SidebarWorkspacePlacement[] = [];
  for (const project of projects) {
    if (project.projectKey === STANDALONE_TASKS_PROJECT_ID) {
      taskWorkspaces.push(...project.workspaces);
    } else {
      visibleProjects.push(project);
    }
  }
  return { projects: visibleProjects, taskWorkspaces };
}

function hostTarget(input: {
  serverId: string;
  iconWorkingDir: string;
}): SidebarProjectHostTarget | null {
  const iconWorkingDir = input.iconWorkingDir.trim();
  if (!input.serverId || !iconWorkingDir) {
    return null;
  }
  return { serverId: input.serverId, iconWorkingDir };
}

export function resolveSidebarProjectIconTarget(
  project: SidebarProjectEntry,
): SidebarProjectHostTarget | null {
  for (const host of project.hosts) {
    const target = hostTarget(host);
    if (target) {
      return target;
    }
  }
  return null;
}

/**
 * A project with one workspace has no ambiguity to resolve, so its chats can sit
 * directly beneath the project like Codex tasks. Multiple workspaces keep their
 * own rows because branch, host, and archive controls still need a visible owner.
 */
export function buildSidebarProjectChildrenModel(
  project: SidebarProjectEntry,
): SidebarProjectChildrenModel {
  const workspace = project.workspaces.length === 1 ? project.workspaces[0] : null;
  return workspace ? { kind: "direct_chats", workspace } : { kind: "workspace_rows" };
}

// A project can host a brand-new workspace on a host when that host can create a
// git worktree (git projects) OR the host supports running multiple independent
// workspaces per directory (`workspaceMultiplicity`), which is what lets non-git
// directories add a second workspace. Mirrors the gate used by the global "New
// workspace" affordances (use-global-new-workspace-action.ts and left-sidebar's
// SidebarNewWorkspaceHeaderRow): `canCreateWorktree || supportsMultiplicity`.
function resolveNewWorkspaceTarget(
  project: SidebarProjectEntry,
  supportsMultiplicityByServerId: ReadonlyMap<string, boolean>,
): SidebarProjectHostTarget | null {
  for (const host of project.hosts) {
    if (!host.canCreateWorktree && !supportsMultiplicityByServerId.get(host.serverId)) {
      continue;
    }
    const target = hostTarget(host);
    if (target) {
      return target;
    }
  }
  return null;
}

function projectTrailingAction(
  project: SidebarProjectEntry,
  supportsMultiplicityByServerId: ReadonlyMap<string, boolean>,
): SidebarProjectTrailingAction {
  const target = resolveNewWorkspaceTarget(project, supportsMultiplicityByServerId);
  return target ? { kind: "new_workspace", target } : { kind: "none" };
}

export function buildSidebarProjectRowModel(input: {
  project: SidebarProjectEntry;
  collapsed: boolean;
  supportsMultiplicityByServerId?: ReadonlyMap<string, boolean>;
}): SidebarProjectRowModel {
  return {
    kind: "project_section",
    chevron: input.collapsed ? "expand" : "collapse",
    trailingAction: projectTrailingAction(
      input.project,
      input.supportsMultiplicityByServerId ?? EMPTY_MULTIPLICITY_MAP,
    ),
  };
}
