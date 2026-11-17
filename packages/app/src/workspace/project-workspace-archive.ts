import {
  confirmRiskyWorktreeArchiveMass,
  isRiskyWorktreeArchive,
  toWorktreeArchiveRisk,
  type WorktreeArchiveConfirmationInput,
} from "@/git/worktree-archive-warning";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { WorkspaceArchiveTarget } from "@/workspace/workspace-archive";

export interface ProjectWorkspaceArchiveEntry extends Pick<
  SidebarWorkspaceEntry,
  | "serverId"
  | "workspaceId"
  | "workspaceKind"
  | "name"
  | "archiveHasUncommittedChanges"
  | "archiveUnpushedCommitCount"
  | "diffStat"
> {}

type ConfirmMassWorktreeArchive = (
  worktrees: WorktreeArchiveConfirmationInput[],
) => Promise<boolean>;

function toConfirmationInput(
  workspace: ProjectWorkspaceArchiveEntry,
): WorktreeArchiveConfirmationInput {
  return { worktreeName: workspace.name, ...toWorktreeArchiveRisk(workspace) };
}

// Workspace IDs are only unique per host, so anything that decides inclusion
// across a multi-host batch has to key on the host as well.
function toIdentity(workspace: ProjectWorkspaceArchiveEntry): string {
  return `${workspace.serverId}:${workspace.workspaceId}`;
}

/**
 * Plans a mass archive with at most one confirmation. Every worktree that would
 * lose uncommitted or unpushed work is named in a single dialog, and that one
 * answer governs all of them — archiving many workspaces must not turn into one
 * dialog per workspace. Clean worktrees and plain checkouts are never prompted.
 */
export async function selectProjectWorkspacesToArchive(
  workspaces: ProjectWorkspaceArchiveEntry[],
  confirmMassWorktreeArchive: ConfirmMassWorktreeArchive = confirmRiskyWorktreeArchiveMass,
): Promise<WorkspaceArchiveTarget[]> {
  const risky = workspaces.filter(
    (workspace) =>
      workspace.workspaceKind === "worktree" &&
      isRiskyWorktreeArchive(toConfirmationInput(workspace)),
  );

  let excluded: ReadonlySet<string> = new Set<string>();
  if (risky.length > 0) {
    const shouldArchiveRisky = await confirmMassWorktreeArchive(risky.map(toConfirmationInput));
    if (!shouldArchiveRisky) {
      excluded = new Set(risky.map(toIdentity));
    }
  }

  return workspaces
    .filter((workspace) => !excluded.has(toIdentity(workspace)))
    .map((workspace) => ({
      serverId: workspace.serverId,
      workspaceId: workspace.workspaceId,
    }));
}
