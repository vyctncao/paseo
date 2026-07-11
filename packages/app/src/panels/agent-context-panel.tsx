import {
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Image,
  Pressable,
  ScrollView,
  Text,
  View,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  FileText,
  ImageIcon,
  Link2,
  MessageSquareText,
  Plus,
} from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AttachmentLightbox } from "@/components/attachment-lightbox";
import { MountedTabActiveContext } from "@/components/split-container";
import { useAttachmentPreviewUrl } from "@/attachments/use-attachment-preview-url";
import type { AttachmentMetadata, UserComposerAttachment } from "@/attachments/types";
import { useIsCompactFormFactor } from "@/constants/layout";
import { usePanelStore } from "@/stores/panel-store";
import { useSessionStore } from "@/stores/session-store";
import { useSubagentsForParent, type SubagentRow } from "@/subagents";
import { resolveRowLabel } from "@/subagents/track-presentation";
import { deriveSidebarStateBucket } from "@/utils/sidebar-agent-state";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { openExternalUrl } from "@/utils/open-external-url";
import type { WorkspaceFileOpenRequest } from "@/workspace/file-open";
import type { Theme } from "@/styles/theme";
import {
  collectAgentContextOutputs,
  collectAgentContextSources,
  collectAgentContextTimelineSubagents,
  type AgentContextSource,
  type AgentContextTimelineSubagent,
} from "./agent-context-panel-model";

const COLLAPSED_OUTPUT_COUNT = 6;
const COLLAPSED_SOURCE_COUNT = 3;
const EMPTY_STREAM_ITEMS = [] as const;

const ThemedBot = withUnistyles(Bot);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedFileText = withUnistyles(FileText);
const ThemedImageIcon = withUnistyles(ImageIcon);
const ThemedLink2 = withUnistyles(Link2);
const ThemedMessageSquareText = withUnistyles(MessageSquareText);
const ThemedPlus = withUnistyles(Plus);

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const accentBrightColorMapping = (theme: Theme) => ({
  color: theme.colors.accentBright,
});

type PressableState = PressableStateCallbackType & { hovered?: boolean };

function interactiveRowStyle({ hovered, pressed }: PressableState): StyleProp<ViewStyle> {
  return [styles.row, (Boolean(hovered) || pressed) && styles.rowActive];
}

interface AgentContextPanelProps {
  serverId: string;
  agentId: string;
  cwd: string;
  isGit: boolean;
  draftAttachments: readonly UserComposerAttachment[];
  onAddSource: () => void;
  onOpenWorkspaceFile?: (request: WorkspaceFileOpenRequest) => void;
}

interface SectionHeaderProps {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}

function SectionHeader({ title, actionLabel, onAction }: SectionHeaderProps): ReactElement {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          hitSlop={8}
          style={styles.headerAction}
        >
          <ThemedPlus size={18} uniProps={foregroundMutedColorMapping} />
        </Pressable>
      ) : null}
    </View>
  );
}

function EmptyRow({ label }: { label: string }): ReactElement {
  return <Text style={styles.emptyText}>{label}</Text>;
}

function ContextRow({
  label,
  onPress,
  testID,
  children,
}: {
  label: string;
  onPress?: () => void;
  testID?: string;
  children: ReactNode;
}): ReactElement {
  const content = (
    <>
      <View style={styles.rowIcon}>{children}</View>
      <Text style={styles.rowLabel} numberOfLines={1}>
        {label}
      </Text>
    </>
  );
  if (!onPress) {
    return (
      <View testID={testID} style={styles.row}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={interactiveRowStyle}
    >
      {content}
    </Pressable>
  );
}

function SourceThumbnail({ metadata }: { metadata: AttachmentMetadata }): ReactElement {
  const previewUrl = useAttachmentPreviewUrl(metadata);
  const source = useMemo(() => ({ uri: previewUrl ?? "" }), [previewUrl]);
  if (!previewUrl) {
    return <View style={styles.sourceThumbnailPlaceholder} />;
  }
  return <Image source={source} style={styles.sourceThumbnail} />;
}

function SourceIcon({ source }: { source: AgentContextSource }): ReactElement {
  if (source.image) {
    return <SourceThumbnail metadata={source.image} />;
  }
  if (source.kind === "link") {
    return <ThemedLink2 size={18} uniProps={foregroundMutedColorMapping} />;
  }
  if (source.kind === "text") {
    return <ThemedMessageSquareText size={18} uniProps={foregroundMutedColorMapping} />;
  }
  if (source.kind === "review") {
    return <ThemedFileText size={18} uniProps={foregroundMutedColorMapping} />;
  }
  return <ThemedImageIcon size={18} uniProps={foregroundMutedColorMapping} />;
}

const SubagentContextRow = memo(function SubagentContextRow({
  row,
  onOpen,
}: {
  row: SubagentRow;
  onOpen: (subagentId: string) => void;
}): ReactElement {
  const handlePress = useCallback(() => onOpen(row.id), [onOpen, row.id]);
  return (
    <ContextRow
      label={resolveRowLabel(row.title) ?? "Subagent"}
      onPress={handlePress}
      testID={`agent-context-subagent-${row.id}`}
    >
      <View style={styles.subagentDot} />
    </ContextRow>
  );
});

const TimelineSubagentContextRow = memo(function TimelineSubagentContextRow({
  row,
}: {
  row: AgentContextTimelineSubagent;
}): ReactElement {
  return (
    <ContextRow label={row.label} testID={`agent-context-${row.key}`}>
      <View style={styles.subagentDot} />
    </ContextRow>
  );
});

const OutputContextRow = memo(function OutputContextRow({
  path,
  label,
  canOpen,
  onOpen,
}: {
  path: string;
  label: string;
  canOpen: boolean;
  onOpen: (path: string) => void;
}): ReactElement {
  const handlePress = useCallback(() => onOpen(path), [onOpen, path]);
  return (
    <ContextRow
      label={label}
      onPress={canOpen ? handlePress : undefined}
      testID={`agent-context-output-${path}`}
    >
      <ThemedFileText size={18} uniProps={foregroundMutedColorMapping} />
    </ContextRow>
  );
});

const SourceContextRow = memo(function SourceContextRow({
  source,
  canOpenWorkspaceFile,
  onOpen,
}: {
  source: AgentContextSource;
  canOpenWorkspaceFile: boolean;
  onOpen: (source: AgentContextSource) => void;
}): ReactElement {
  const canOpen = Boolean(source.image || source.url || (source.path && canOpenWorkspaceFile));
  const handlePress = useCallback(() => onOpen(source), [onOpen, source]);
  return (
    <ContextRow
      label={source.label}
      onPress={canOpen ? handlePress : undefined}
      testID={`agent-context-source-${source.key}`}
    >
      <SourceIcon source={source} />
    </ContextRow>
  );
});

function subagentSummary(
  rows: readonly SubagentRow[],
  timelineRows: readonly AgentContextTimelineSubagent[],
): string {
  const counts = {
    running: 0,
    done: 0,
    failed: 0,
    needsInput: 0,
  };
  for (const row of rows) {
    const bucket = deriveSidebarStateBucket({
      status: row.status,
      requiresAttention: row.requiresAttention,
    });
    if (bucket === "running") counts.running += 1;
    else if (bucket === "failed") counts.failed += 1;
    else if (bucket === "needs_input" || bucket === "attention") counts.needsInput += 1;
    else counts.done += 1;
  }
  for (const row of timelineRows) {
    if (row.status === "running") counts.running += 1;
    else if (row.status === "failed") counts.failed += 1;
    else counts.done += 1;
  }
  const parts: string[] = [];
  if (counts.running) parts.push(`${counts.running} running`);
  if (counts.needsInput) parts.push(`${counts.needsInput} needs input`);
  if (counts.failed) parts.push(`${counts.failed} failed`);
  if (counts.done) parts.push(`${counts.done} done`);
  return parts.join(" · ");
}

function SubagentsSection({
  rows,
  timelineRows,
  serverId,
}: {
  rows: readonly SubagentRow[];
  timelineRows: readonly AgentContextTimelineSubagent[];
  serverId: string;
}): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const toggleExpanded = useCallback(() => setExpanded((current) => !current), []);
  const openSubagent = useCallback(
    (subagentId: string) => {
      navigateToAgent({ serverId, agentId: subagentId });
    },
    [serverId],
  );

  if (rows.length === 0 && timelineRows.length === 0) {
    return <EmptyRow label="No subagents" />;
  }

  const summary = subagentSummary(rows, timelineRows);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={summary}
        onPress={toggleExpanded}
        style={interactiveRowStyle}
      >
        <View style={styles.rowIcon}>
          <ThemedBot size={18} uniProps={accentBrightColorMapping} />
        </View>
        <Text style={styles.rowLabel} numberOfLines={1}>
          {summary}
        </Text>
        {expanded ? (
          <ThemedChevronDown size={16} uniProps={foregroundMutedColorMapping} />
        ) : (
          <ThemedChevronRight size={16} uniProps={foregroundMutedColorMapping} />
        )}
      </Pressable>
      {expanded
        ? [
            ...rows.map((row) => (
              <SubagentContextRow key={row.id} row={row} onOpen={openSubagent} />
            )),
            ...timelineRows.map((row) => <TimelineSubagentContextRow key={row.key} row={row} />),
          ]
        : null}
    </>
  );
}

export const AgentContextPanel = memo(function AgentContextPanel({
  serverId,
  agentId,
  cwd,
  isGit,
  draftAttachments,
  onAddSource,
  onOpenWorkspaceFile,
}: AgentContextPanelProps): ReactElement {
  const isActive = useContext(MountedTabActiveContext);
  const tail = useSessionStore(
    (state) => state.sessions[serverId]?.agentStreamTail?.get(agentId) ?? EMPTY_STREAM_ITEMS,
  );
  const head = useSessionStore(
    (state) => state.sessions[serverId]?.agentStreamHead?.get(agentId) ?? EMPTY_STREAM_ITEMS,
  );
  const liveStreamItems = useMemo(() => [...tail, ...head], [head, tail]);
  const frozenStreamItemsRef = useRef(liveStreamItems);
  if (isActive) {
    frozenStreamItemsRef.current = liveStreamItems;
  }
  const streamItems = isActive ? liveStreamItems : frozenStreamItemsRef.current;
  const outputs = useMemo(() => collectAgentContextOutputs(streamItems), [streamItems]);
  const sources = useMemo(
    () => collectAgentContextSources({ streamItems, draftAttachments }),
    [draftAttachments, streamItems],
  );
  const subagents = useSubagentsForParent({ serverId, parentAgentId: agentId });
  const timelineSubagents = useMemo(
    () => collectAgentContextTimelineSubagents(streamItems),
    [streamItems],
  );
  const [showAllOutputs, setShowAllOutputs] = useState(false);
  const [showAllSources, setShowAllSources] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<AttachmentMetadata | null>(null);
  const isCompact = useIsCompactFormFactor();
  const openFileExplorerForCheckout = usePanelStore((state) => state.openFileExplorerForCheckout);
  const setExplorerTabForCheckout = usePanelStore((state) => state.setExplorerTabForCheckout);

  useEffect(() => {
    setShowAllOutputs(false);
    setShowAllSources(false);
    setLightboxImage(null);
  }, [agentId]);

  const visibleOutputs = showAllOutputs ? outputs : outputs.slice(0, COLLAPSED_OUTPUT_COUNT);
  const visibleSources = showAllSources ? sources : sources.slice(0, COLLAPSED_SOURCE_COUNT);
  const hiddenOutputCount = Math.max(0, outputs.length - visibleOutputs.length);
  const hiddenSourceCount = Math.max(0, sources.length - visibleSources.length);
  const toggleOutputs = useCallback(() => setShowAllOutputs((current) => !current), []);
  const toggleSources = useCallback(() => setShowAllSources((current) => !current), []);
  const closeLightbox = useCallback(() => setLightboxImage(null), []);
  const openOutputs = useCallback(() => {
    const checkout = { serverId, cwd, isGit };
    openFileExplorerForCheckout({ checkout, isCompact });
    setExplorerTabForCheckout({ ...checkout, tab: "files" });
  }, [cwd, isCompact, isGit, openFileExplorerForCheckout, serverId, setExplorerTabForCheckout]);
  const openOutput = useCallback(
    (path: string) => {
      onOpenWorkspaceFile?.({ location: { path }, disposition: "side" });
    },
    [onOpenWorkspaceFile],
  );
  const openSource = useCallback(
    (source: AgentContextSource) => {
      if (source.image) {
        setLightboxImage(source.image);
        return;
      }
      if (source.url) {
        void openExternalUrl(source.url);
        return;
      }
      if (source.path && onOpenWorkspaceFile) {
        onOpenWorkspaceFile({ location: { path: source.path }, disposition: "side" });
      }
    },
    [onOpenWorkspaceFile],
  );

  return (
    <View style={styles.surface} testID="agent-context-panel">
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <SectionHeader title="Outputs" actionLabel="Open workspace files" onAction={openOutputs} />
        {visibleOutputs.length === 0 ? (
          <EmptyRow label="No outputs yet" />
        ) : (
          visibleOutputs.map((output) => (
            <OutputContextRow
              key={output.path}
              path={output.path}
              label={output.label}
              canOpen={Boolean(onOpenWorkspaceFile)}
              onOpen={openOutput}
            />
          ))
        )}
        {hiddenOutputCount > 0 || showAllOutputs ? (
          <Pressable onPress={toggleOutputs} style={styles.showMoreButton}>
            <Text style={styles.showMoreText}>
              {showAllOutputs ? "Show less" : `Show ${hiddenOutputCount} more`}
            </Text>
          </Pressable>
        ) : null}

        <View style={styles.divider} />

        <SectionHeader title="Subagents" />
        <SubagentsSection
          rows={subagents}
          timelineRows={timelineSubagents}
          serverId={serverId}
        />

        <View style={styles.divider} />

        <SectionHeader title="Sources" actionLabel="Add image source" onAction={onAddSource} />
        {visibleSources.length === 0 ? (
          <EmptyRow label="No sources yet" />
        ) : (
          visibleSources.map((source) => (
            <SourceContextRow
              key={source.key}
              source={source}
              canOpenWorkspaceFile={Boolean(onOpenWorkspaceFile)}
              onOpen={openSource}
            />
          ))
        )}
        {hiddenSourceCount > 0 || showAllSources ? (
          <Pressable onPress={toggleSources} style={styles.showMoreButton}>
            <Text style={styles.showMoreText}>
              {showAllSources ? "Show less" : `View ${hiddenSourceCount} more`}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
      <AttachmentLightbox metadata={lightboxImage} onClose={closeLightbox} />
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  surface: {
    width: "100%",
    maxHeight: "100%",
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius["2xl"],
    overflow: "hidden",
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[4],
  },
  sectionHeader: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: theme.spacing[2],
  },
  sectionTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  headerAction: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.full,
  },
  row: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.base,
  },
  rowActive: {
    backgroundColor: theme.colors.surface2,
  },
  rowIcon: {
    width: 24,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  rowLabel: {
    minWidth: 0,
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  emptyText: {
    minHeight: 38,
    paddingHorizontal: theme.spacing[1],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 38,
  },
  divider: {
    height: theme.borderWidth[1],
    backgroundColor: theme.colors.borderAccent,
    marginVertical: theme.spacing[4],
  },
  showMoreButton: {
    alignSelf: "flex-start",
    paddingHorizontal: theme.spacing[1],
    paddingVertical: theme.spacing[1],
  },
  showMoreText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  sourceThumbnail: {
    width: 24,
    height: 24,
    borderRadius: theme.borderRadius.sm,
  },
  sourceThumbnailPlaceholder: {
    width: 24,
    height: 24,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface2,
  },
  subagentDot: {
    width: 10,
    height: 10,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accentBright,
  },
}));
