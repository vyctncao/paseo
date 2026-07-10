import React, { useCallback, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AgentPet } from "@/components/pet/agent-pet";
import type { SidebarAgentRow as SidebarAgentRowModel } from "./sidebar-agent-rows";

export interface SidebarAgentRowProps {
  row: SidebarAgentRowModel;
  /** Spritesheet for the pet assigned to this chat's provider; null when none is installed. */
  petSpritesheetUrl: string | null;
  petRows: number;
  onPress: (tabId: string) => void;
  onClose?: (tabId: string) => void;
}

/**
 * A chat, rendered beneath its branch: title and folder on the left, pet and tools
 * on the right. Replaces one anonymous icon in the desktop tab strip.
 */
export function SidebarAgentRowView({
  row,
  petSpritesheetUrl,
  petRows,
  onPress,
  onClose,
}: SidebarAgentRowProps) {
  const handlePress = useCallback(() => onPress(row.tabId), [onPress, row.tabId]);
  const handleClose = useCallback(() => onClose?.(row.tabId), [onClose, row.tabId]);
  const accessibilityState = useMemo(() => ({ selected: row.isActive }), [row.isActive]);

  return (
    <Pressable
      onPress={handlePress}
      style={row.isActive ? styles.rowActive : styles.row}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      accessibilityLabel={`${row.title}, ${row.folder}`}
      testID={`sidebar-agent-row-${row.tabId}`}
    >
      <View style={styles.text}>
        <Text numberOfLines={1} style={styles.title}>
          {row.title}
        </Text>
        <Text numberOfLines={1} style={styles.folder}>
          {row.folder}
        </Text>
      </View>

      <View style={styles.tools}>
        {petSpritesheetUrl ? (
          <AgentPet
            spritesheetUrl={petSpritesheetUrl}
            rows={petRows}
            lifecycle={row.lifecycle}
            size={20}
            accessibilityLabel={`${row.title} is ${row.lifecycle}`}
          />
        ) : null}
        {onClose ? (
          <Pressable
            onPress={handleClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Close ${row.title}`}
            testID={`sidebar-agent-row-close-${row.tabId}`}
          >
            <Text style={styles.close}>×</Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  rowActive: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  text: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  folder: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  tools: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  close: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
