import { Fragment, useCallback } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { settingsStyles } from "@/styles/settings";
import { ProviderUsageCard } from "./card";
import type { ProviderUsage } from "./types";

export function ProviderUsageList({
  providers,
  hiddenProviderIds,
  onProviderVisibilityChange,
}: {
  providers: ProviderUsage[];
  hiddenProviderIds?: ReadonlySet<string>;
  onProviderVisibilityChange?: (providerId: string, visible: boolean) => void;
}) {
  return (
    <View style={settingsStyles.card}>
      {providers.map((usage, index) => (
        <ProviderUsageListItem
          key={usage.providerId}
          usage={usage}
          showDivider={index > 0}
          displayEnabled={!hiddenProviderIds?.has(usage.providerId)}
          onProviderVisibilityChange={onProviderVisibilityChange}
        />
      ))}
    </View>
  );
}

function ProviderUsageListItem({
  usage,
  showDivider,
  displayEnabled,
  onProviderVisibilityChange,
}: {
  usage: ProviderUsage;
  showDivider: boolean;
  displayEnabled: boolean;
  onProviderVisibilityChange?: (providerId: string, visible: boolean) => void;
}) {
  const handleDisplayEnabledChange = useCallback(
    (visible: boolean) => {
      onProviderVisibilityChange?.(usage.providerId, visible);
    },
    [onProviderVisibilityChange, usage.providerId],
  );

  return (
    <Fragment>
      {showDivider ? <View style={styles.divider} /> : null}
      <ProviderUsageCard
        usage={usage}
        displayEnabled={displayEnabled}
        onDisplayEnabledChange={onProviderVisibilityChange ? handleDisplayEnabledChange : undefined}
      />
    </Fragment>
  );
}

const styles = StyleSheet.create((theme) => ({
  divider: {
    height: 1,
    backgroundColor: theme.colors.border,
  },
}));
