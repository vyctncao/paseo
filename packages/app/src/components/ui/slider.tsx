import { useMemo } from "react";
import CommunitySlider, {
  type SliderProps as CommunitySliderProps,
} from "@react-native-community/slider";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";

const ThemedCommunitySlider = withUnistyles(CommunitySlider, (theme: Theme) => ({
  minimumTrackTintColor: theme.colors.accent,
  maximumTrackTintColor: theme.colors.border,
  thumbTintColor: theme.colors.palette.white,
}));

export type SliderProps = Omit<
  CommunitySliderProps,
  "minimumTrackTintColor" | "maximumTrackTintColor" | "thumbTintColor"
>;

/**
 * Theme-aware single-value slider shared by native, browser, and Electron.
 * Callers own the range and persistence policy; colors and hit-area geometry
 * stay consistent here.
 */
export function Slider({ style, tapToSeek = true, ...props }: SliderProps) {
  const controlStyle = useMemo(() => [styles.control, style], [style]);
  return <ThemedCommunitySlider {...props} tapToSeek={tapToSeek} style={controlStyle} />;
}

const styles = StyleSheet.create(() => ({
  control: {
    height: 40,
    minWidth: 160,
  },
}));
