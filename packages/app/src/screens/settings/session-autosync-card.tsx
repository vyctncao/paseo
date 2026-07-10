import React, { useCallback } from "react";
import { Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";
import {
  createSessionAutosyncPatch,
  getSessionAutosyncCardState,
  getSessionAutosyncMutationViewState,
} from "./session-autosync-config";

export function SessionAutosyncCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);
  const state = getSessionAutosyncCardState({ isConnected, config });
  const mutation = useMutation({
    mutationFn: async (next: boolean) => {
      const result = await patchConfig(createSessionAutosyncPatch(next));
      if (!result) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      return result;
    },
  });
  const mutationView = getSessionAutosyncMutationViewState({
    isPending: mutation.isPending,
    error: mutation.error,
  });

  const handleValueChange = useCallback(
    (next: boolean) => {
      mutation.mutate(next);
    },
    [mutation],
  );

  if (!state.isVisible) return null;

  return (
    <View style={settingsStyles.card} testID="host-page-session-autosync-card">
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{state.title}</Text>
          <Text style={settingsStyles.rowHint}>{state.hint}</Text>
          {mutationView.loadingText ? (
            <Text style={settingsStyles.rowHint} testID="host-page-session-autosync-loading">
              {mutationView.loadingText}
            </Text>
          ) : null}
          {mutationView.errorText ? (
            <Text style={settingsStyles.rowError} testID="host-page-session-autosync-error">
              {mutationView.errorText}
            </Text>
          ) : null}
        </View>
        <Switch
          value={state.isEnabled}
          onValueChange={handleValueChange}
          disabled={mutationView.isSwitchDisabled}
          accessibilityLabel="Enable CLI session autosync"
          testID="host-page-session-autosync-switch"
        />
      </View>
    </View>
  );
}
