import { useMemo } from "react";
import { StyleSheet as RNStyleSheet, View } from "react-native";
import Svg, { Defs, Ellipse, LinearGradient, Rect, RadialGradient, Stop } from "react-native-svg";
import { useAppSettings } from "@/hooks/use-settings";
import { THEME_BACKDROPS, type BackdropSceneId, type ThemeBackdrop } from "@/styles/theme";

// The active theme's backdrop, or null for non-glass themes. Chrome that changes
// STRUCTURE for glass themes (floating sidebar, pill treatments) must branch on
// this React-side value: on web, Unistyles only varies color values per theme
// within a shared class, so structural styles cannot be theme-tracked.
export function useThemeBackdrop(): ThemeBackdrop | null {
  const { settings } = useAppSettings();
  return settings.theme === "auto" ? null : THEME_BACKDROPS[settings.theme];
}

// The gradient scene glass themes render behind the app shell. Purely decorative:
// absolutely positioned under all content, never interactive. Scenes are authored
// in a fixed 1440x900 viewBox and cover-scaled to the viewport, so blob placement
// stays composition-stable across window sizes.
//
// Scene choice reads the persisted theme setting (plain React state) instead of the
// Unistyles theme: ShadowRegistry updates repaint tracked styles without
// re-rendering, and on web only color values vary per theme within a shared class —
// so neither a theme-mapped prop nor a theme-tracked `display` toggle survives a
// theme switch.
//
// Soft-edged blobs are radial gradients fading to transparent — translucent surface
// tokens over an already-soft scene read as frosted glass without needing a real
// backdrop blur on every panel.

interface SceneBlob {
  cx: number;
  cy: number;
  r: number;
  color: string;
  opacity: number;
}

const SCENE_BLOBS: Record<BackdropSceneId, SceneBlob[]> = {
  aurora: [
    { cx: 230, cy: 100, r: 520, color: "#7C3AED", opacity: 0.55 },
    { cx: 1330, cy: 70, r: 520, color: "#2563EB", opacity: 0.5 },
    { cx: 800, cy: 840, r: 560, color: "#0D9488", opacity: 0.46 },
    { cx: 1420, cy: 800, r: 420, color: "#DB2777", opacity: 0.4 },
  ],
  mesh: [
    { cx: 0, cy: 0, r: 700, color: "#3A1D5E", opacity: 0.55 },
    { cx: 1440, cy: 0, r: 700, color: "#1B2447", opacity: 0.6 },
    { cx: 0, cy: 900, r: 700, color: "#0F3B38", opacity: 0.5 },
    { cx: 1440, cy: 900, r: 700, color: "#2A1E47", opacity: 0.55 },
  ],
  deep: [{ cx: 720, cy: 420, r: 640, color: "#3A4A7A", opacity: 0.4 }],
  sweep: [{ cx: 430, cy: 180, r: 600, color: "#6D5AE0", opacity: 0.32 }],
  ember: [
    { cx: 210, cy: 120, r: 500, color: "#F43F5E", opacity: 0.48 },
    { cx: 1290, cy: 90, r: 500, color: "#EA580C", opacity: 0.48 },
    { cx: 820, cy: 830, r: 560, color: "#F59E0B", opacity: 0.44 },
    { cx: 1420, cy: 760, r: 380, color: "#FBBF24", opacity: 0.38 },
  ],
};

// SVG reference ids must be fragment-safe: no "#" from the hex color.
function blobGradientId(scene: BackdropSceneId, blob: SceneBlob): string {
  return `blob-${scene}-${blob.color.slice(1)}-${blob.cx}`;
}

interface SceneSvgProps {
  scene: BackdropSceneId;
}

function SceneSvg({ scene }: SceneSvgProps) {
  const blobs = SCENE_BLOBS[scene];
  return (
    <Svg width="100%" height="100%" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
      <Defs>
        {scene === "sweep" ? (
          <LinearGradient id="sweep-wash" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#0B1030" />
            <Stop offset="0.5" stopColor="#141A3A" />
            <Stop offset="1" stopColor="#2A1E47" />
          </LinearGradient>
        ) : null}
        {blobs.map((blob) => (
          <RadialGradient key={blobGradientId(scene, blob)} id={blobGradientId(scene, blob)}>
            <Stop offset="0" stopColor={blob.color} stopOpacity={blob.opacity} />
            <Stop offset="1" stopColor={blob.color} stopOpacity={0} />
          </RadialGradient>
        ))}
      </Defs>
      {scene === "sweep" ? (
        <Rect x="0" y="0" width="1440" height="900" fill="url(#sweep-wash)" />
      ) : null}
      {blobs.map((blob) => (
        <Ellipse
          key={blobGradientId(scene, blob)}
          cx={blob.cx}
          cy={blob.cy}
          rx={blob.r}
          ry={blob.r * 0.82}
          fill={`url(#${blobGradientId(scene, blob)})`}
        />
      ))}
    </Svg>
  );
}

export function AppBackdrop() {
  const backdrop = useThemeBackdrop();
  const containerStyle = useMemo(
    () => [styles.container, { backgroundColor: backdrop?.base ?? "transparent" }],
    [backdrop],
  );
  if (!backdrop) return null;
  return (
    <View style={containerStyle} pointerEvents="none">
      <SceneSvg scene={backdrop.scene} />
    </View>
  );
}

const styles = RNStyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
