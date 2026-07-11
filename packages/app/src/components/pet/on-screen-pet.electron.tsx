import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { DesktopPetActivity, DesktopPetOverlayState } from "@/desktop/host";
import {
  markDesktopPetRendererReady,
  updateDesktopPetOverlay,
} from "@/desktop/pets/desktop-pet-bridge";
import { listenToDesktopEvent } from "@/desktop/electron/events";
import { useAggregatedAgents } from "@/hooks/use-aggregated-agents";
import { useCodexPets } from "@/hooks/use-codex-pets";
import {
  useServerHttpAuthorizationHeader,
  useServerHttpBaseUrl,
} from "@/hooks/use-server-http-base-url";
import { useAppSettings } from "@/hooks/use-settings";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { PASEO_COMPANION_PET_KEY } from "./pet-assignment";
import {
  selectOnScreenPetModel,
  type PetActivityBucket,
  type PetActivityRow,
} from "./on-screen-pet-model";

const MAX_OVERLAY_ACTIVITIES = 20;

export interface OnScreenPetProps {
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

/** Electron replaces the in-app pet with a real transparent desktop window. */
export function OnScreenPet({ serverId, visible }: OnScreenPetProps) {
  const { t } = useTranslation();
  const { settings } = useAppSettings();
  const { agents } = useAggregatedAgents();
  const baseUrl = useServerHttpBaseUrl(serverId);
  const spritesheetAuthorizationHeader = useServerHttpAuthorizationHeader(serverId);
  const { petForProvider } = useCodexPets(baseUrl, spritesheetAuthorizationHeader);
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
  const overlayState = useMemo<DesktopPetOverlayState>(() => {
    if (!visible || !pet) return { visible: false };
    const activities: DesktopPetActivity[] = model.activities
      .slice(0, MAX_OVERLAY_ACTIVITIES)
      .map((activity) => ({
        key: activity.key,
        serverId: activity.serverId,
        agentId: activity.agentId,
        workspaceId: activity.workspaceId,
        title: activityTitle(activity, t("pet.activity.untitled")),
        hostLabel: activity.serverLabel,
        status: activity.bucket,
        statusLabel: statusLabels[activity.bucket],
      }));
    return {
      visible: true,
      spritesheetUrl: pet.spritesheetUrl,
      ...(spritesheetAuthorizationHeader ? { spritesheetAuthorizationHeader } : {}),
      rows: pet.rows,
      lifecycle: model.lifecycle,
      size: settings.petSize,
      totalActivityCount: model.activities.length,
      trayTitle: t("pet.activity.title"),
      activities,
    };
  }, [model, pet, settings.petSize, spritesheetAuthorizationHeader, statusLabels, t, visible]);

  useEffect(() => {
    void updateDesktopPetOverlay(overlayState).catch((error) => {
      console.warn("[DesktopPet] Failed to update the overlay", error);
    });
  }, [overlayState]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void (async () => {
      unlisten = await listenToDesktopEvent<DesktopPetActivity>("pet-open-activity", (activity) => {
        navigateToAgent({
          serverId: activity.serverId,
          agentId: activity.agentId,
          workspaceId: activity.workspaceId,
          pin: true,
        });
      });
      if (disposed) {
        unlisten();
        return;
      }
      await markDesktopPetRendererReady();
    })().catch((error) => {
      console.warn("[DesktopPet] Failed to initialize desktop navigation", error);
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return null;
}
