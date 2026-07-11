import { describe, expect, it } from "vitest";
import {
  resolveDisplayedPickerItem,
  shouldEnableWorktreeForPickerItem,
} from "./new-workspace-isolation";

describe("new workspace isolation controls", () => {
  it("shows the current branch for local workspaces", () => {
    expect(
      resolveDisplayedPickerItem({
        selectedItem: { kind: "branch", name: "feature/previous" },
        currentBranch: "staging",
        isolation: "local",
      }),
    ).toEqual({ kind: "branch", name: "staging" });
  });

  it("shows the selected branch for worktrees", () => {
    expect(
      resolveDisplayedPickerItem({
        selectedItem: { kind: "branch", name: "feature/new" },
        currentBranch: "staging",
        isolation: "worktree",
      }),
    ).toEqual({ kind: "branch", name: "feature/new" });
  });

  it("enables worktree isolation when a different branch is selected", () => {
    expect(
      shouldEnableWorktreeForPickerItem({
        item: { kind: "branch", name: "feature/new" },
        currentBranch: "staging",
        canCreateWorktree: true,
      }),
    ).toBe(true);
    expect(
      shouldEnableWorktreeForPickerItem({
        item: { kind: "branch", name: "staging" },
        currentBranch: "staging",
        canCreateWorktree: true,
      }),
    ).toBe(false);
  });
});
