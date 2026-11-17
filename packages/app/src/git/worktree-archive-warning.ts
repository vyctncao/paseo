import { confirmDialog } from "@/utils/confirm-dialog";
import { i18n } from "@/i18n/i18next";

export interface WorktreeArchiveRisk {
  isDirty?: boolean | null;
  aheadOfOrigin?: number | null;
  diffStat?: { additions: number; deletions: number } | null;
}

export interface WorktreeArchiveRiskInput {
  archiveHasUncommittedChanges?: boolean | null;
  archiveUnpushedCommitCount?: number | null;
  diffStat?: WorktreeArchiveRisk["diffStat"];
}

export interface WorktreeArchiveConfirmationInput extends WorktreeArchiveRisk {
  worktreeName: string;
}

export interface WorktreeArchiveWarningLabels {
  title: (worktreeName: string) => string;
  massTitle: (count: number) => string;
  confirm: string;
  cancel: string;
  uncommittedChanges: string;
  uncommittedChangesWithDiff: (diffStat: string) => string;
  addedLine: (count: number) => string;
  deletedLine: (count: number) => string;
  unpushedCommit: (count: number) => string;
}

export const DEFAULT_WORKTREE_ARCHIVE_WARNING_LABELS: WorktreeArchiveWarningLabels = {
  title: (worktreeName) => i18n.t("workspace.git.actions.archiveWarning.title", { worktreeName }),
  massTitle: (count) => i18n.t("workspace.git.actions.archiveWarning.massTitle", { count }),
  confirm: i18n.t("workspace.git.actions.archiveWarning.confirm"),
  cancel: i18n.t("workspace.git.actions.archiveWarning.cancel"),
  uncommittedChanges: i18n.t("workspace.git.actions.archiveWarning.uncommittedChanges"),
  uncommittedChangesWithDiff: (diffStat) =>
    i18n.t("workspace.git.actions.archiveWarning.uncommittedChangesWithDiff", { diffStat }),
  addedLine: (count) =>
    count === 1
      ? i18n.t("workspace.git.actions.archiveWarning.addedLine", { count })
      : i18n.t("workspace.git.actions.archiveWarning.addedLines", { count }),
  deletedLine: (count) =>
    count === 1
      ? i18n.t("workspace.git.actions.archiveWarning.deletedLine", { count })
      : i18n.t("workspace.git.actions.archiveWarning.deletedLines", { count }),
  unpushedCommit: (count) =>
    count === 1
      ? i18n.t("workspace.git.actions.archiveWarning.unpushedCommit", { count })
      : i18n.t("workspace.git.actions.archiveWarning.unpushedCommits", { count }),
};

export function toWorktreeArchiveRisk(input: WorktreeArchiveRiskInput): WorktreeArchiveRisk {
  return {
    isDirty: input.archiveHasUncommittedChanges,
    aheadOfOrigin: input.archiveUnpushedCommitCount,
    diffStat: input.diffStat,
  };
}

function formatDiffStat(
  diffStat: WorktreeArchiveRisk["diffStat"],
  labels: WorktreeArchiveWarningLabels,
): string | null {
  if (!diffStat) {
    return null;
  }

  const parts: string[] = [];
  if (diffStat.additions > 0) {
    parts.push(labels.addedLine(diffStat.additions));
  }
  if (diffStat.deletions > 0) {
    parts.push(labels.deletedLine(diffStat.deletions));
  }

  return parts.length > 0 ? parts.join(", ") : null;
}

export function buildWorktreeArchiveRiskReasons(
  input: WorktreeArchiveRisk,
  labels: WorktreeArchiveWarningLabels = DEFAULT_WORKTREE_ARCHIVE_WARNING_LABELS,
): string[] {
  const reasons: string[] = [];
  const diffStat = input.diffStat;
  const hasDiffStatChanges = diffStat ? diffStat.additions > 0 || diffStat.deletions > 0 : false;
  const hasUncommittedChanges =
    input.isDirty === true || (input.isDirty == null && hasDiffStatChanges);

  if (hasUncommittedChanges) {
    const diffStatLabel = formatDiffStat(diffStat, labels);
    reasons.push(
      diffStatLabel ? labels.uncommittedChangesWithDiff(diffStatLabel) : labels.uncommittedChanges,
    );
  }

  if ((input.aheadOfOrigin ?? 0) > 0) {
    const aheadOfOrigin = input.aheadOfOrigin ?? 0;
    reasons.push(labels.unpushedCommit(aheadOfOrigin));
  }

  return reasons;
}

export function buildWorktreeArchiveConfirmationMessage(
  input: WorktreeArchiveConfirmationInput,
  labels: WorktreeArchiveWarningLabels = DEFAULT_WORKTREE_ARCHIVE_WARNING_LABELS,
): string | null {
  const reasons = buildWorktreeArchiveRiskReasons(input, labels);
  if (reasons.length === 0) {
    return null;
  }

  return reasons.join("\n");
}

/**
 * A worktree is only worth confirming when archiving it would discard work that
 * lives nowhere else. Callers that both prompt about a set and act on the answer
 * must agree on that set, so they share this predicate rather than re-deriving it.
 */
export function isRiskyWorktreeArchive(
  input: WorktreeArchiveConfirmationInput,
  labels: WorktreeArchiveWarningLabels = DEFAULT_WORKTREE_ARCHIVE_WARNING_LABELS,
): boolean {
  return buildWorktreeArchiveConfirmationMessage(input, labels) !== null;
}

export function buildMassWorktreeArchiveMessage(
  worktrees: WorktreeArchiveConfirmationInput[],
  labels: WorktreeArchiveWarningLabels = DEFAULT_WORKTREE_ARCHIVE_WARNING_LABELS,
): string | null {
  const sections = worktrees.flatMap((worktree) => {
    const reasons = buildWorktreeArchiveConfirmationMessage(worktree, labels);
    return reasons ? [`${worktree.worktreeName}\n${reasons}`] : [];
  });

  return sections.length > 0 ? sections.join("\n\n") : null;
}

export async function confirmRiskyWorktreeArchive(
  input: WorktreeArchiveConfirmationInput,
  labels: WorktreeArchiveWarningLabels = DEFAULT_WORKTREE_ARCHIVE_WARNING_LABELS,
): Promise<boolean> {
  const message = buildWorktreeArchiveConfirmationMessage(input, labels);
  if (!message) {
    return true;
  }

  return await confirmDialog({
    title: labels.title(input.worktreeName),
    message,
    confirmLabel: labels.confirm,
    cancelLabel: labels.cancel,
    destructive: true,
  });
}

/**
 * Asks once for a whole batch instead of once per worktree. A single risky
 * worktree reuses the singular dialog verbatim, so the plural copy only ever
 * appears when there is genuinely more than one thing to weigh.
 */
export async function confirmRiskyWorktreeArchiveMass(
  worktrees: WorktreeArchiveConfirmationInput[],
  labels: WorktreeArchiveWarningLabels = DEFAULT_WORKTREE_ARCHIVE_WARNING_LABELS,
): Promise<boolean> {
  const risky = worktrees.filter((worktree) => isRiskyWorktreeArchive(worktree, labels));
  if (risky.length === 0) {
    return true;
  }

  const soleRiskyWorktree = risky[0];
  if (risky.length === 1 && soleRiskyWorktree) {
    return await confirmRiskyWorktreeArchive(soleRiskyWorktree, labels);
  }

  const message = buildMassWorktreeArchiveMessage(risky, labels);
  if (!message) {
    return true;
  }

  return await confirmDialog({
    title: labels.massTitle(risky.length),
    message,
    confirmLabel: labels.confirm,
    cancelLabel: labels.cancel,
    destructive: true,
  });
}
