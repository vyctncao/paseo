import React, { useEffect, useMemo, useState } from "react";
import { Image } from "expo-image";
import { View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import {
  PET_CELL_HEIGHT,
  PET_CELL_WIDTH,
  PET_FRAMES_PER_ROW,
  PET_WAVE_DURATION_MS,
  petFrameCount,
  petFrameDurationMs,
  petFrameRect,
  petStateForLifecycle,
  type AgentPetLifecycle,
  type PetState,
} from "./pet-sprite";

export interface AgentPetProps {
  spritesheetUrl: string;
  /** Row count of the atlas: 9 for a v1 sheet, 11 for v2. The daemon reports it. */
  rows: number;
  lifecycle: AgentPetLifecycle;
  /** Rendered edge length in px. The 192x208 cell is scaled to fit. */
  size?: number;
  accessibilityLabel?: string;
  /** Optional bearer header for pets served by a protected direct daemon. */
  authorizationHeader?: string | null;
}

/**
 * Hold `waving` for a beat after an agent finishes, then settle to `idle`. Without
 * this the "done" signal would vanish on the same tick the agent goes idle, which
 * is precisely the moment you want to notice.
 */
function useSettlingPetState(lifecycle: AgentPetLifecycle): PetState {
  const [state, setState] = useState<PetState>(() => petStateForLifecycle(lifecycle));

  useEffect(() => {
    setState(petStateForLifecycle(lifecycle));
    if (lifecycle !== "completed") return undefined;

    const timer = setTimeout(() => setState("idle"), PET_WAVE_DURATION_MS);
    return () => clearTimeout(timer);
  }, [lifecycle]);

  return state;
}

/** Advances each state with its contract frame count and per-frame timing. */
function useFrameCounter(state: PetState, reducedMotion: boolean): number {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    setFrame(0);
    if (reducedMotion) return undefined;

    let disposed = false;
    let current = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleNext = () => {
      timer = setTimeout(
        () => {
          if (disposed) return;
          current = (current + 1) % petFrameCount(state);
          setFrame(current);
          scheduleNext();
        },
        petFrameDurationMs(state, current),
      );
    };
    scheduleNext();

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [reducedMotion, state]);

  return frame;
}

export function AgentPet({
  spritesheetUrl,
  rows,
  lifecycle,
  size = 48,
  accessibilityLabel,
  authorizationHeader,
}: AgentPetProps) {
  const state = useSettlingPetState(lifecycle);
  const reducedMotion = useReducedMotion();
  const frame = useFrameCounter(state, reducedMotion);
  const rect = petFrameRect(state, frame, rows);
  const scale = size / PET_CELL_WIDTH;
  const source = useMemo(
    () => ({
      uri: spritesheetUrl,
      ...(authorizationHeader ? { headers: { Authorization: authorizationHeader } } : {}),
    }),
    [authorizationHeader, spritesheetUrl],
  );

  // The full sheet is laid out at scaled size and positioned so the wanted cell
  // sits at the window's origin; the window clips the rest. Absolute offsets,
  // rather than a transform, so there is no scale-origin to reason about.
  const windowStyle = useMemo(
    () => [styles.window, { width: size, height: PET_CELL_HEIGHT * scale }],
    [size, scale],
  );
  const sheetStyle = useMemo(
    () => ({
      position: "absolute" as const,
      width: PET_CELL_WIDTH * PET_FRAMES_PER_ROW * scale,
      height: PET_CELL_HEIGHT * rows * scale,
      left: rect.offsetX * scale,
      top: rect.offsetY * scale,
    }),
    [rows, scale, rect.offsetX, rect.offsetY],
  );

  return (
    <View
      style={windowStyle}
      accessibilityLabel={accessibilityLabel ?? `Agent pet: ${state}`}
      testID="agent-pet"
    >
      <Image source={source} style={sheetStyle} contentFit="fill" transition={0} />
    </View>
  );
}

const styles = StyleSheet.create(() => ({
  window: {
    overflow: "hidden",
  },
}));
