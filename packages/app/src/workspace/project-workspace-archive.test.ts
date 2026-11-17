import { describe, expect, it } from "vitest";
import type { WorktreeArchiveConfirmationInput } from "@/git/worktree-archive-warning";
import {
  type ProjectWorkspaceArchiveEntry,
  selectProjectWorkspacesToArchive,
} from "@/workspace/project-workspace-archive";

/** In-memory confirmation port: records what it was asked, answers a fixed way. */
function recordingConfirm(answer: boolean) {
  const calls: WorktreeArchiveConfirmationInput[][] = [];
  const confirm = async (worktrees: WorktreeArchiveConfirmationInput[]) => {
    calls.push(worktrees);
    return answer;
  };
  return { calls, confirm };
}

const riskyWorktreeA: ProjectWorkspaceArchiveEntry = {
  serverId: "server-1",
  workspaceId: "workspace-worktree-a",
  workspaceKind: "worktree",
  name: "feature/risky-a",
  archiveHasUncommittedChanges: true,
  archiveUnpushedCommitCount: 2,
  diffStat: { additions: 5, deletions: 1 },
};

const riskyWorktreeB: ProjectWorkspaceArchiveEntry = {
  serverId: "server-1",
  workspaceId: "workspace-worktree-b",
  workspaceKind: "worktree",
  name: "feature/risky-b",
  archiveHasUncommittedChanges: false,
  archiveUnpushedCommitCount: 3,
  diffStat: null,
};

const cleanWorktree: ProjectWorkspaceArchiveEntry = {
  serverId: "server-1",
  workspaceId: "workspace-worktree-clean",
  workspaceKind: "worktree",
  name: "feature/clean",
  archiveHasUncommittedChanges: false,
  archiveUnpushedCommitCount: 0,
  diffStat: null,
};

const checkout: ProjectWorkspaceArchiveEntry = {
  serverId: "server-1",
  workspaceId: "workspace-checkout",
  workspaceKind: "local_checkout",
  name: "main",
  archiveHasUncommittedChanges: null,
  archiveUnpushedCommitCount: null,
  diffStat: null,
};

describe("selectProjectWorkspacesToArchive", () => {
  it("asks once for the whole batch and archives every workspace when accepted", async () => {
    const { calls, confirm } = recordingConfirm(true);

    const targets = await selectProjectWorkspacesToArchive(
      [checkout, riskyWorktreeA, riskyWorktreeB],
      confirm,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([
      {
        worktreeName: "feature/risky-a",
        isDirty: true,
        aheadOfOrigin: 2,
        diffStat: { additions: 5, deletions: 1 },
      },
      {
        worktreeName: "feature/risky-b",
        isDirty: false,
        aheadOfOrigin: 3,
        diffStat: null,
      },
    ]);
    expect(targets).toEqual([
      { serverId: "server-1", workspaceId: "workspace-checkout" },
      { serverId: "server-1", workspaceId: "workspace-worktree-a" },
      { serverId: "server-1", workspaceId: "workspace-worktree-b" },
    ]);
  });

  it("asks once for the whole batch and excludes every risky worktree when declined", async () => {
    const { calls, confirm } = recordingConfirm(false);

    const targets = await selectProjectWorkspacesToArchive(
      [checkout, riskyWorktreeA, riskyWorktreeB],
      confirm,
    );

    expect(calls).toHaveLength(1);
    expect(targets).toEqual([{ serverId: "server-1", workspaceId: "workspace-checkout" }]);
  });

  it("does not confirm when nothing in the batch would lose work", async () => {
    const { calls, confirm } = recordingConfirm(false);

    const targets = await selectProjectWorkspacesToArchive([checkout, cleanWorktree], confirm);

    expect(calls).toEqual([]);
    expect(targets).toEqual([
      { serverId: "server-1", workspaceId: "workspace-checkout" },
      { serverId: "server-1", workspaceId: "workspace-worktree-clean" },
    ]);
  });

  it("keeps clean workspaces and input order when the batch confirmation is declined", async () => {
    const { calls, confirm } = recordingConfirm(false);

    const targets = await selectProjectWorkspacesToArchive(
      [checkout, riskyWorktreeA, cleanWorktree],
      confirm,
    );

    expect(calls).toHaveLength(1);
    expect(targets).toEqual([
      { serverId: "server-1", workspaceId: "workspace-checkout" },
      { serverId: "server-1", workspaceId: "workspace-worktree-clean" },
    ]);
  });

  it("excludes risky worktrees by host and workspace, not by workspace id alone", async () => {
    const { calls, confirm } = recordingConfirm(false);

    const targets = await selectProjectWorkspacesToArchive(
      [
        { ...riskyWorktreeA, serverId: "server-1", workspaceId: "shared-id" },
        { ...riskyWorktreeB, serverId: "server-2", workspaceId: "shared-id" },
        { ...checkout, serverId: "server-2", workspaceId: "shared-id-checkout" },
      ],
      confirm,
    );

    expect(calls).toHaveLength(1);
    expect(targets).toEqual([{ serverId: "server-2", workspaceId: "shared-id-checkout" }]);
  });
});
