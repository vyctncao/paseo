import React, { useCallback, useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import {
  buildWorkspaceTabPersistenceKey,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { SidebarAgentRowView } from "./sidebar-agent-row";
import { buildSidebarWorkspaceGroup } from "./sidebar-agent-rows";
import { useSidebarWorkspaceAgentGroup } from "./use-sidebar-workspace-agent-group";

// Step one renders every group expanded. Per-workspace collapse is a later step, so
// the pure builder gets an empty set rather than a store it cannot yet read.
const NO_COLLAPSED_IDS: ReadonlySet<string> = new Set();

export interface SidebarWorkspaceAgentListProps {
  serverId: string;
  workspaceId: string;
  branch: string | null;
  displayName: string;
  /** Project-level rows align with the project title; workspace rows stay one level deeper. */
  nesting?: "project" | "workspace";
}

/**
 * The chats open in one workspace, listed beneath its sidebar row.
 *
 * Selection calls `focusTab`, the same action the desktop tab strip uses, so no route
 * changes. `navigateToWorkspace` runs first because — unlike the strip, which can only
 * show the active workspace's tabs — a sidebar row may belong to a workspace that is
 * not on screen. Closing a chat is not wired here: it carries archive-confirm semantics
 * that live in `workspace-screen`, so the strip keeps owning it until those move.
 */
export function SidebarWorkspaceAgentList({
  serverId,
  workspaceId,
  branch,
  displayName,
  nesting = "workspace",
}: SidebarWorkspaceAgentListProps) {
  const group = useSidebarWorkspaceAgentGroup({ serverId, workspaceId, branch, displayName });
  const focusTab = useWorkspaceLayoutStore((state) => state.focusTab);

  const handlePress = useCallback(
    (tabId: string) => {
      const key = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
      navigateToWorkspace(serverId, workspaceId);
      if (key) focusTab(key, tabId);
    },
    [focusTab, serverId, workspaceId],
  );

  const rows = useMemo(() => {
    if (!group) return [];
    return buildSidebarWorkspaceGroup({
      workspace: group.input,
      activeTabId: group.activeTabId,
      collapsedWorkspaceIds: NO_COLLAPSED_IDS,
      showAgentRows: nesting === "project",
    }).rows;
  }, [group, nesting]);
  const listStyle = useMemo(
    () => [styles.list, nesting === "project" ? styles.projectList : styles.workspaceList],
    [nesting],
  );

  if (rows.length === 0) return null;

  return (
    <View style={listStyle}>
      {rows.map((row) => (
        <SidebarAgentRowView key={row.tabId} row={row} onPress={handlePress} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: {
    paddingRight: theme.spacing[1],
    paddingTop: 2,
    paddingBottom: theme.spacing[2],
    gap: 1,
  },
  projectList: {
    paddingLeft: theme.spacing[6],
  },
  workspaceList: {
    paddingLeft: theme.spacing[4],
  },
}));
