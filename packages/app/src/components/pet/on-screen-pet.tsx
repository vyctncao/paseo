import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PASEO_COMPANION_PET_KEY } from "@/components/pet/pet-assignment";
import { useAggregatedAgents } from "@/hooks/use-aggregated-agents";
import { useCodexPets } from "@/hooks/use-codex-pets";
import {
  useServerHttpAuthorizationHeader,
  useServerHttpBaseUrl,
} from "@/hooks/use-server-http-base-url";
import { useAppSettings } from "@/hooks/use-settings";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { AgentPet } from "./agent-pet";
import {
  selectOnScreenPetModel,
  type PetActivityBucket,
  type PetActivityRow,
} from "./on-screen-pet-model";

export interface OnScreenPetProps {
  /** Host used only to load the selected pet's sprite assets. Activity is global. */
  serverId: string;
  visible: boolean;
  rightOffset?: number;
}

function activityTitle(activity: PetActivityRow, untitledLabel: string): string {
  const title = activity.title?.trim();
  if (title) return title;
  const pathParts = activity.cwd.split(/[\\/]/).filter(Boolean);
  return pathParts.at(-1) ?? untitledLabel;
}

function statusLabel(bucket: PetActivityBucket, labels: Record<PetActivityBucket, string>): string {
  return labels[bucket];
}

function PetActivityMenuItem({
  activity,
  hostCount,
  labels,
  onSelect,
}: {
  activity: PetActivityRow;
  hostCount: number;
  labels: Record<PetActivityBucket, string>;
  onSelect: (activity: PetActivityRow) => void;
}) {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => onSelect(activity), [activity, onSelect]);
  const title = activityTitle(activity, t("pet.activity.untitled"));
  const label = statusLabel(activity.bucket, labels);
  const location = hostCount > 1 ? `${activity.serverLabel} · ${activity.cwd}` : activity.cwd;

  return (
    <DropdownMenuItem
      leading={ACTIVITY_STATUS_DOTS[activity.bucket]}
      description={`${label} · ${location}`}
      onSelect={handleSelect}
      testID={`on-screen-pet-activity-${activity.key}`}
    >
      {title}
    </DropdownMenuItem>
  );
}

/**
 * Persistent app companion and global activity tray. Its sprite comes from the
 * current asset host, while its activity rows can open chats on any host/model.
 */
export function OnScreenPet({ serverId, visible, rightOffset = 0 }: OnScreenPetProps) {
  const insets = useSafeAreaInsets();
  const isCompact = useIsCompactFormFactor();
  const { t } = useTranslation();
  const [trayOpen, setTrayOpen] = useState(false);
  const { settings } = useAppSettings();
  const { agents } = useAggregatedAgents();
  const baseUrl = useServerHttpBaseUrl(serverId);
  const authorizationHeader = useServerHttpAuthorizationHeader(serverId);
  const { petForProvider } = useCodexPets(baseUrl, authorizationHeader);
  const pet = petForProvider(PASEO_COMPANION_PET_KEY, settings.selectedPetId);
  const model = useMemo(() => selectOnScreenPetModel({ agents }), [agents]);
  const statusLabels = useMemo<Record<PetActivityBucket, string>>(
    () => ({
      needs_input: t("pet.activity.status.needsInput"),
      failed: t("pet.activity.status.blocked"),
      attention: t("pet.activity.status.ready"),
      running: t("pet.activity.status.running"),
    }),
    [t],
  );
  const hostCount = useMemo(
    () => new Set(model.activities.map((activity) => activity.serverId)).size,
    [model.activities],
  );

  const handleActivitySelect = useCallback((activity: PetActivityRow) => {
    navigateToAgent({
      serverId: activity.serverId,
      agentId: activity.agentId,
      workspaceId: activity.workspaceId,
      pin: true,
    });
  }, []);

  const size = settings.petSize;
  const anchorStyle = useMemo(
    () => [
      styles.anchor,
      {
        right: insets.right + rightOffset + 24,
        bottom: insets.bottom + (isCompact ? 104 : 112),
      },
    ],
    [insets.bottom, insets.right, isCompact, rightOffset],
  );
  const activityCount = model.activities.length;
  let activitySummary: string;
  if (activityCount === 0) {
    activitySummary = t("pet.activity.summaryNone");
  } else if (activityCount === 1) {
    activitySummary = t("pet.activity.summaryOne");
  } else {
    activitySummary = t("pet.activity.summaryMany", { count: activityCount });
  }
  const accessibilityLabel = `${pet?.displayName ?? t("pet.name")}. ${activitySummary}`;
  const accessibilityState = useMemo(() => ({ expanded: trayOpen }), [trayOpen]);
  const triggerStyle = useCallback(
    ({ pressed }: PressableStateCallbackType & { open: boolean }) => [
      styles.trigger,
      pressed && styles.triggerPressed,
    ],
    [],
  );

  if (!visible || !pet) return null;

  return (
    <View style={anchorStyle} pointerEvents="box-none">
      <DropdownMenu open={trayOpen} onOpenChange={setTrayOpen}>
        <DropdownMenuTrigger
          hitSlop={8}
          style={triggerStyle}
          accessibilityRole="button"
          accessibilityState={accessibilityState}
          accessibilityLabel={accessibilityLabel}
          testID="on-screen-pet"
        >
          <AgentPet
            key={model.primary?.key ?? "idle"}
            spritesheetUrl={pet.spritesheetUrl}
            rows={pet.rows}
            lifecycle={model.lifecycle}
            size={size}
            authorizationHeader={authorizationHeader}
            accessibilityLabel={accessibilityLabel}
          />
          {activityCount > 0 ? (
            <View style={styles.badge} testID="on-screen-pet-activity-count">
              <Text style={styles.badgeText}>{activityCount > 99 ? "99+" : activityCount}</Text>
            </View>
          ) : null}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="end"
          width={isCompact ? undefined : 320}
          fullWidth={isCompact}
          horizontalPadding={16}
          scrollable
          maxHeight={360}
          testID="on-screen-pet-activity-tray"
        >
          <DropdownMenuLabel>{t("pet.activity.title")}</DropdownMenuLabel>
          {model.activities.length === 0 ? (
            <View style={styles.emptyTray}>
              <Text style={styles.emptyTrayText}>{t("pet.activity.empty")}</Text>
            </View>
          ) : (
            model.activities.map((activity) => (
              <PetActivityMenuItem
                key={activity.key}
                activity={activity}
                hostCount={hostCount}
                labels={statusLabels}
                onSelect={handleActivitySelect}
              />
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  anchor: {
    position: "absolute",
    zIndex: 20,
  },
  trigger: {
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
  },
  triggerPressed: {
    opacity: 0.72,
  },
  badge: {
    position: "absolute",
    top: 2,
    right: 0,
    minWidth: 22,
    height: 22,
    paddingHorizontal: theme.spacing[1],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
    borderWidth: 2,
    borderColor: theme.colors.background,
  },
  badgeText: {
    color: theme.colors.accentForeground,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
  },
  statusDotNeedsInput: {
    width: 9,
    height: 9,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.palette.amber[500],
  },
  statusDotFailed: {
    width: 9,
    height: 9,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.palette.red[500],
  },
  statusDotAttention: {
    width: 9,
    height: 9,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.palette.green[500],
  },
  statusDotRunning: {
    width: 9,
    height: 9,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.palette.blue[500],
  },
  emptyTray: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[4],
  },
  emptyTrayText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));

const ACTIVITY_STATUS_DOTS: Record<PetActivityBucket, ReactElement> = {
  needs_input: <View style={styles.statusDotNeedsInput} />,
  failed: <View style={styles.statusDotFailed} />,
  attention: <View style={styles.statusDotAttention} />,
  running: <View style={styles.statusDotRunning} />,
};
