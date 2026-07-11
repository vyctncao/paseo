import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { Globe, SquareTerminal, X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";

const ThemedX = withUnistyles(X);
const ThemedGlobe = withUnistyles(Globe);
const ThemedSquareTerminal = withUnistyles(SquareTerminal);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });

interface PanelChromeHeaderProps {
  icon: "browser" | "terminal";
  title: string;
  subtitle?: string | null;
  closeLabel: string;
  onClose: () => void;
}

function closeButtonStyle({ hovered, pressed }: PressableStateCallbackType) {
  return [styles.closeButton, (hovered || pressed) && styles.closeButtonHovered];
}

export function PanelChromeHeader({
  icon,
  title,
  subtitle,
  closeLabel,
  onClose,
}: PanelChromeHeaderProps) {
  const leadingIcon =
    icon === "browser" ? (
      <ThemedGlobe size={15} uniProps={mutedColorMapping} />
    ) : (
      <ThemedSquareTerminal size={15} uniProps={mutedColorMapping} />
    );
  return (
    <View style={styles.container}>
      <View style={styles.identity}>
        <View style={styles.icon}>{leadingIcon}</View>
        <Text numberOfLines={1} style={styles.title}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={styles.subtitle}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
        onPress={onClose}
        style={closeButtonStyle}
      >
        {({ hovered, pressed }) => (
          <ThemedX
            size={14}
            uniProps={hovered || pressed ? foregroundColorMapping : mutedColorMapping}
          />
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    height: 40,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[3],
  },
  identity: {
    minWidth: 0,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  icon: {
    flexShrink: 0,
  },
  title: {
    flexShrink: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  subtitle: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  closeButton: {
    width: 28,
    height: 28,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  closeButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
}));
