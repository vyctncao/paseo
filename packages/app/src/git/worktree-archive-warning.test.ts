import { describe, expect, it } from "vitest";

import {
  buildMassWorktreeArchiveMessage,
  buildWorktreeArchiveConfirmationMessage,
  buildWorktreeArchiveRiskReasons,
  isRiskyWorktreeArchive,
  toWorktreeArchiveRisk,
} from "@/git/worktree-archive-warning";

describe("worktree archive warning", () => {
  it("does not require a confirmation for clean and pushed worktrees", () => {
    expect(
      buildWorktreeArchiveConfirmationMessage({
        worktreeName: "feature",
        isDirty: false,
        aheadOfOrigin: 0,
        diffStat: null,
      }),
    ).toBeNull();
  });

  it("explains uncommitted line changes", () => {
    expect(
      buildWorktreeArchiveRiskReasons({
        isDirty: true,
        aheadOfOrigin: 0,
        diffStat: { additions: 12, deletions: 1 },
      }),
    ).toEqual(["Uncommitted changes (12 added lines, 1 deleted line)"]);
  });

  it("treats nonzero diff stats as dirty when dirty state is missing", () => {
    expect(
      buildWorktreeArchiveRiskReasons({
        isDirty: undefined,
        aheadOfOrigin: 0,
        diffStat: { additions: 4, deletions: 0 },
      }),
    ).toEqual(["Uncommitted changes (4 added lines)"]);
  });

  it("explains unpushed commits", () => {
    expect(
      buildWorktreeArchiveRiskReasons({
        isDirty: false,
        aheadOfOrigin: 2,
        diffStat: null,
      }),
    ).toEqual(["2 unpushed commits"]);
  });

  it("includes every archive risk in the confirmation copy", () => {
    expect(
      buildWorktreeArchiveConfirmationMessage({
        worktreeName: "risky-feature",
        isDirty: true,
        aheadOfOrigin: 1,
        diffStat: { additions: 1, deletions: 3 },
      }),
    ).toBe("Uncommitted changes (1 added line, 3 deleted lines)\n1 unpushed commit");
  });

  it("flags only worktrees whose archive would discard work", () => {
    expect(
      isRiskyWorktreeArchive({
        worktreeName: "dirty",
        isDirty: true,
        aheadOfOrigin: 0,
        diffStat: null,
      }),
    ).toBe(true);
    expect(
      isRiskyWorktreeArchive({
        worktreeName: "clean",
        isDirty: false,
        aheadOfOrigin: 0,
        diffStat: null,
      }),
    ).toBe(false);
  });

  it("names every risky worktree in one batch confirmation", () => {
    expect(
      buildMassWorktreeArchiveMessage([
        {
          worktreeName: "feature/a",
          isDirty: true,
          aheadOfOrigin: 0,
          diffStat: { additions: 2, deletions: 0 },
        },
        { worktreeName: "feature/clean", isDirty: false, aheadOfOrigin: 0, diffStat: null },
        { worktreeName: "feature/b", isDirty: false, aheadOfOrigin: 2, diffStat: null },
      ]),
    ).toBe("feature/a\nUncommitted changes (2 added lines)\n\nfeature/b\n2 unpushed commits");
  });

  it("does not require a batch confirmation when every worktree is clean", () => {
    expect(
      buildMassWorktreeArchiveMessage([
        { worktreeName: "feature/a", isDirty: false, aheadOfOrigin: 0, diffStat: null },
        { worktreeName: "feature/b", isDirty: false, aheadOfOrigin: 0, diffStat: null },
      ]),
    ).toBeNull();
  });

  it("maps archive workspace fields into the shared worktree risk shape", () => {
    expect(
      toWorktreeArchiveRisk({
        archiveHasUncommittedChanges: true,
        archiveUnpushedCommitCount: 3,
        diffStat: { additions: 2, deletions: 1 },
      }),
    ).toEqual({
      isDirty: true,
      aheadOfOrigin: 3,
      diffStat: { additions: 2, deletions: 1 },
    });
  });
});
