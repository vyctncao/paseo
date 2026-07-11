import type { PickerItem } from "./new-workspace-picker-item";

export function shouldEnableWorktreeForPickerItem(input: {
  item: PickerItem;
  currentBranch: string | null;
  canCreateWorktree: boolean;
}): boolean {
  if (!input.canCreateWorktree) return false;
  return input.item.kind === "github-pr" || input.item.name !== input.currentBranch;
}

export function resolveDisplayedPickerItem(input: {
  selectedItem: PickerItem | null;
  currentBranch: string | null;
  isolation: "local" | "worktree";
}): PickerItem | null {
  if (input.isolation === "worktree" && input.selectedItem) return input.selectedItem;
  return input.currentBranch ? { kind: "branch", name: input.currentBranch } : null;
}
