import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  Text,
  View,
  type AccessibilityActionEvent,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Zap } from "lucide-react-native";

export interface ThinkingEffortOption {
  id: string;
  label: string;
}

interface ThinkingEffortSliderProps {
  options: ThinkingEffortOption[];
  selectedOptionId?: string;
  onSelect: (optionId: string) => void;
  disabled?: boolean;
  title: string;
}

const THUMB_SIZE = 32;
const TRACK_HEIGHT = 28;
const EFFORT_ACCENT = "#c79bf7";
const EFFORT_ACCESSIBILITY_ACTIONS = [
  { name: "decrement" as const },
  { name: "increment" as const },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function resolveSelectedIndex(
  options: ThinkingEffortOption[],
  selectedOptionId: string | undefined,
): number {
  const selectedIndex = options.findIndex((option) => option.id === selectedOptionId);
  return selectedIndex >= 0 ? selectedIndex : 0;
}

function resolveIndexFromLocation(input: {
  locationX: number;
  trackWidth: number;
  optionCount: number;
}): number {
  if (input.optionCount <= 1 || input.trackWidth <= THUMB_SIZE) {
    return 0;
  }

  const thumbTravel = input.trackWidth - THUMB_SIZE;
  const thumbLeft = clamp(input.locationX - THUMB_SIZE / 2, 0, thumbTravel);
  return Math.round((thumbLeft / thumbTravel) * (input.optionCount - 1));
}

export function ThinkingEffortSlider({
  options,
  selectedOptionId,
  onSelect,
  disabled = false,
  title,
}: ThinkingEffortSliderProps): ReactElement | null {
  const selectedIndex = resolveSelectedIndex(options, selectedOptionId);
  const [previewIndex, setPreviewIndex] = useState(selectedIndex);
  const [trackWidth, setTrackWidth] = useState(0);
  const isInteractingRef = useRef(false);
  const lastCommittedIdRef = useRef(options[selectedIndex]?.id ?? null);

  useEffect(() => {
    lastCommittedIdRef.current = options[selectedIndex]?.id ?? null;
    if (!isInteractingRef.current) {
      setPreviewIndex(selectedIndex);
    }
  }, [options, selectedIndex]);

  const commitIndex = useCallback(
    (index: number) => {
      const option = options[index];
      if (!option || option.id === lastCommittedIdRef.current) {
        return;
      }
      lastCommittedIdRef.current = option.id;
      onSelect(option.id);
    },
    [onSelect, options],
  );

  const indexFromEvent = useCallback(
    (event: GestureResponderEvent) =>
      resolveIndexFromLocation({
        locationX: event.nativeEvent.locationX,
        trackWidth,
        optionCount: options.length,
      }),
    [options.length, trackWidth],
  );

  const handleResponderGrant = useCallback(
    (event: GestureResponderEvent) => {
      isInteractingRef.current = true;
      setPreviewIndex(indexFromEvent(event));
    },
    [indexFromEvent],
  );

  const handleResponderMove = useCallback(
    (event: GestureResponderEvent) => {
      setPreviewIndex(indexFromEvent(event));
    },
    [indexFromEvent],
  );

  const handleResponderRelease = useCallback(
    (event: GestureResponderEvent) => {
      const nextIndex = indexFromEvent(event);
      setPreviewIndex(nextIndex);
      isInteractingRef.current = false;
      commitIndex(nextIndex);
    },
    [commitIndex, indexFromEvent],
  );

  const handleResponderTerminate = useCallback(() => {
    isInteractingRef.current = false;
    setPreviewIndex(selectedIndex);
  }, [selectedIndex]);

  const handleTrackLayout = useCallback((event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  }, []);

  const handleShouldSetResponder = useCallback(() => !disabled, [disabled]);
  const handleResponderTerminationRequest = useCallback(() => true, []);

  const handleAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      const direction = event.nativeEvent.actionName === "increment" ? 1 : -1;
      const nextIndex = clamp(previewIndex + direction, 0, options.length - 1);
      setPreviewIndex(nextIndex);
      commitIndex(nextIndex);
    },
    [commitIndex, options.length, previewIndex],
  );

  const progress = options.length > 1 ? previewIndex / (options.length - 1) : 0;
  const thumbTravel = Math.max(trackWidth - THUMB_SIZE, 0);
  const thumbLeft = thumbTravel * progress;
  const fillWidth = trackWidth > 0 ? thumbLeft + THUMB_SIZE / 2 : 0;
  const selectedOption = options[previewIndex] ?? options[0];
  const fillStyle = useMemo(() => ({ width: fillWidth }), [fillWidth]);
  const thumbStyle = useMemo(() => ({ left: thumbLeft }), [thumbLeft]);
  const composedFillStyle = useMemo(() => [styles.fill, fillStyle], [fillStyle]);
  const composedThumbStyle = useMemo(() => [styles.thumb, thumbStyle], [thumbStyle]);
  const sliderStyle = useMemo(() => [styles.slider, disabled && styles.disabled], [disabled]);
  const accessibilityValue = useMemo(
    () => ({
      min: 1,
      max: options.length,
      now: previewIndex + 1,
      text: selectedOption?.label,
    }),
    [options.length, previewIndex, selectedOption?.label],
  );

  if (options.length === 0) {
    return null;
  }

  return (
    <View style={styles.panel} testID="agent-thinking-effort-slider-panel">
      <View style={styles.header}>
        <View style={styles.headerTextRow}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.value}>{selectedOption?.label}</Text>
        </View>
        <Zap size={16} color={EFFORT_ACCENT} fill={EFFORT_ACCENT} />
      </View>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={title}
        accessibilityValue={accessibilityValue}
        accessibilityActions={EFFORT_ACCESSIBILITY_ACTIONS}
        onAccessibilityAction={handleAccessibilityAction}
        onLayout={handleTrackLayout}
        onStartShouldSetResponder={handleShouldSetResponder}
        onMoveShouldSetResponder={handleShouldSetResponder}
        onResponderGrant={handleResponderGrant}
        onResponderMove={handleResponderMove}
        onResponderRelease={handleResponderRelease}
        onResponderTerminate={handleResponderTerminate}
        onResponderTerminationRequest={handleResponderTerminationRequest}
        style={sliderStyle}
        testID="agent-thinking-effort-slider"
      >
        <View pointerEvents="none" style={styles.track}>
          <View style={composedFillStyle} />
          <View style={styles.dotRail}>
            {options.map((option, index) => (
              <View key={option.id} style={index < previewIndex ? styles.activeDot : styles.dot} />
            ))}
          </View>
          <View style={composedThumbStyle} testID="agent-thinking-effort-slider-thumb" />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  panel: {
    width: "100%",
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[3],
    gap: theme.spacing[3],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  headerTextRow: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "baseline",
    gap: theme.spacing[2],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  value: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
  },
  slider: {
    width: "100%",
    height: THUMB_SIZE,
    justifyContent: "center",
  },
  disabled: {
    opacity: 0.5,
  },
  track: {
    width: "100%",
    height: TRACK_HEIGHT,
    overflow: "visible",
    borderRadius: TRACK_HEIGHT / 2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
  },
  fill: {
    position: "absolute",
    top: -1,
    bottom: -1,
    left: -1,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: EFFORT_ACCENT,
  },
  dotRail: {
    position: "absolute",
    top: 0,
    right: THUMB_SIZE / 2,
    bottom: 0,
    left: THUMB_SIZE / 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.surface4,
  },
  activeDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255, 255, 255, 0.72)",
  },
  thumb: {
    position: "absolute",
    top: (TRACK_HEIGHT - THUMB_SIZE) / 2 - 1,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    borderWidth: 1,
    backgroundColor: theme.colors.palette.white,
    ...theme.shadow.md,
  },
}));
