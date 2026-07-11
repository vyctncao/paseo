import { useQueryClient } from "@tanstack/react-query";
import { Archive } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { agentHistoryQueryKey } from "@/hooks/agent-history-query-key";
import { useAgentHistory } from "@/hooks/use-agent-history";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { formatTimeAgo } from "@/utils/time";
import type { Theme } from "@/styles/theme";
import { buildSidebarArchivedAgentGroups } from "./sidebar-archived-agents-model";

const ThemedArchive = withUnistyles(Archive);
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

export function SidebarArchivedAgents({
  enabled,
  scroll,
  onWorkspacePress,
}: {
  enabled: boolean;
  scroll: boolean;
  onWorkspacePress?: () => void;
}) {
  const queryClient = useQueryClient();
  const hostFilters = useSidebarViewStore((state) => state.hostFilters);
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Set<string>>(() => new Set());
  const { agents, isInitialLoad, isError, hasMore, isLoadingMore, loadMore } = useAgentHistory({
    enabled,
  });
  const groups = useMemo(
    () => buildSidebarArchivedAgentGroups({ agents, hostFilters, expandedGroupKeys }),
    [agents, expandedGroupKeys, hostFilters],
  );

  const toggleGroup = useCallback((key: string) => {
    setExpandedGroupKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const openAgent = useCallback(
    (agent: AggregatedAgent) => {
      const client = getHostRuntimeStore().getClient(agent.serverId);
      if (!client) return;
      void client
        .refreshAgent(agent.id)
        .then(() => {
          onWorkspacePress?.();
          navigateToAgent({
            serverId: agent.serverId,
            agentId: agent.id,
            workspaceId: agent.workspaceId,
            pin: false,
          });
          return queryClient.invalidateQueries({
            queryKey: agentHistoryQueryKey(agent.serverId),
          });
        })
        .catch(() => {});
    },
    [onWorkspacePress, queryClient],
  );

  if (!enabled) return null;

  const content = (
    <View style={styles.content} testID="sidebar-archived-tasks">
      <View style={styles.sectionHeader}>
        <ThemedArchive size={14} uniProps={foregroundMutedColorMapping} />
        <Text style={styles.sectionTitle}>Archived</Text>
      </View>
      {isInitialLoad ? <Text style={styles.emptyText}>Loading archived tasks...</Text> : null}
      {!isInitialLoad && isError && groups.length === 0 ? (
        <Text style={styles.emptyText}>Unable to load archived tasks</Text>
      ) : null}
      {!isInitialLoad && !isError && groups.length === 0 ? (
        <Text style={styles.emptyText}>No archived tasks</Text>
      ) : null}
      {groups.map((group) => (
        <View key={group.key} style={styles.projectGroup}>
          <Text style={styles.projectTitle} numberOfLines={1}>
            {group.label}
          </Text>
          {group.visibleAgents.map((agent) => (
            <ArchivedAgentRow
              key={`${agent.serverId}:${agent.id}`}
              agent={agent}
              onPress={openAgent}
            />
          ))}
          {group.hiddenCount > 0 || group.expanded ? (
            <ArchivedGroupToggle
              groupKey={group.key}
              expanded={group.expanded}
              hiddenCount={group.hiddenCount}
              onToggle={toggleGroup}
            />
          ) : null}
        </View>
      ))}
      {hasMore ? (
        <Button variant="ghost" size="sm" onPress={loadMore} disabled={isLoadingMore}>
          {isLoadingMore ? "Loading..." : "Load more archived"}
        </Button>
      ) : null}
    </View>
  );

  return scroll ? (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      testID="sidebar-archived-tasks-scroll"
    >
      {content}
    </ScrollView>
  ) : (
    content
  );
}

function ArchivedGroupToggle({
  groupKey,
  expanded,
  hiddenCount,
  onToggle,
}: {
  groupKey: string;
  expanded: boolean;
  hiddenCount: number;
  onToggle: (key: string) => void;
}) {
  const handlePress = useCallback(() => onToggle(groupKey), [groupKey, onToggle]);
  return (
    <Button variant="ghost" size="xs" onPress={handlePress} style={styles.showMoreButton}>
      {expanded ? "Show less" : `Show ${hiddenCount} more`}
    </Button>
  );
}

function ArchivedAgentRow({
  agent,
  onPress,
}: {
  agent: AggregatedAgent;
  onPress: (agent: AggregatedAgent) => void;
}) {
  const handlePress = useCallback(() => onPress(agent), [agent, onPress]);
  const rowStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      (hovered || pressed) && styles.rowActive,
    ],
    [],
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open archived task ${agent.title || "Untitled task"}`}
      onPress={handlePress}
      style={rowStyle}
      testID={`sidebar-archived-agent-${agent.serverId}-${agent.id}`}
    >
      <Text style={styles.rowTitle} numberOfLines={1}>
        {agent.title || "Untitled task"}
      </Text>
      <Text style={styles.rowMeta}>{formatTimeAgo(agent.lastActivityAt)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[4],
  },
  content: {
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[2],
  },
  sectionTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  projectGroup: {
    paddingBottom: theme.spacing[3],
  },
  projectTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    paddingHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  row: {
    minHeight: 30,
    marginLeft: theme.spacing[4],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  rowActive: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  rowTitle: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.ui,
    fontWeight: theme.fontWeight.medium,
    lineHeight: 20,
  },
  rowMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  showMoreButton: {
    alignSelf: "flex-start",
    marginLeft: theme.spacing[4],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
}));
