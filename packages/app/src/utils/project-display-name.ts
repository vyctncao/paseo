export function projectDisplayNameFromProjectId(projectId: string): string {
  const githubRemotePrefix = "remote:github.com/";
  if (projectId.startsWith(githubRemotePrefix)) {
    return projectId.slice(githubRemotePrefix.length) || projectId;
  }

  const segments = projectId.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || projectId;
}

export function projectIconPlaceholderLabelFromDisplayName(displayName: string): string {
  const trimmedDisplayName = displayName.trim();
  if (!trimmedDisplayName) {
    return "";
  }

  const segments = trimmedDisplayName.split("/").filter(Boolean);
  return segments[segments.length - 1] || trimmedDisplayName;
}

/**
 * Returns the folder name shown for a project in the sidebar.
 *
 * Project display names can intentionally include an owner (for example,
 * `getpaseo/paseo`). The sidebar mirrors Codex by preferring the checked-out
 * folder name while keeping that richer display name available elsewhere.
 */
export function sidebarProjectFolderName(
  projectRootPath: string | null | undefined,
  fallbackDisplayName: string,
): string {
  const pathSegments = (projectRootPath?.trim() ?? "").split(/[\\/]/).filter(Boolean);
  const pathBasename = pathSegments[pathSegments.length - 1];

  if (pathBasename && !/^[A-Za-z]:$/.test(pathBasename)) {
    return pathBasename;
  }

  const trimmedFallback = fallbackDisplayName.trim();
  const fallbackSegments = trimmedFallback.split(/[\\/]/).filter(Boolean);
  return fallbackSegments[fallbackSegments.length - 1] || fallbackDisplayName;
}
