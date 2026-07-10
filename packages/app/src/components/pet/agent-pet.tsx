import React, { useEffect, useMemo, useRef, useState } from "react";
import { Image, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  PET_CELL_HEIGHT,
  PET_CELL_WIDTH,
  PET_FRAME_DURATION_MS,
  PET_FRAMES_PER_ROW,
  PET_WAVE_DURATION_MS,
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
}

/**
 * Hold `waving` for a beat after an agent finishes, then settle to `idle`. Without
 * this the "done" signal would vanish on the same tick the agent goes idle, which
 * is precisely the moment you want to notice.
 */
function useSettlingPetState(lifecycle: AgentPetLifecycle): PetState {
  const [state, setState] = useState<PetState>(() => petStateForLifecycle(lifecycle));
  const previous = useRef(lifecycle);

  useEffect(() => {
    const justFinished = previous.current !== "completed" && lifecycle === "completed";
    previous.current = lifecycle;
    setState(petStateForLifecycle(lifecycle));
    if (!justFinished) return undefined;

    const timer = setTimeout(() => setState("idle"), PET_WAVE_DURATION_MS);
    return () => clearTimeout(timer);
  }, [lifecycle]);

  return state;
}

/** Advances the frame counter only while the state actually animates. */
function useFrameCounter(animating: boolean): number {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!animating) {
      setFrame(0);
      return undefined;
    }
    const timer = setInterval(
      () => setFrame((current) => (current + 1) % PET_FRAMES_PER_ROW),
      PET_FRAME_DURATION_MS,
    );
    return () => clearInterval(timer);
  }, [animating]);

  return frame;
}

export function AgentPet({
  spritesheetUrl,
  rows,
  lifecycle,
  size = 48,
  accessibilityLabel,
}: AgentPetProps) {
  const state = useSettlingPetState(lifecycle);
  const frame = useFrameCounter(state !== "idle");
  const rect = petFrameRect(state, frame, rows);
  const scale = size / PET_CELL_WIDTH;
  const source = useMemo(() => ({ uri: spritesheetUrl }), [spritesheetUrl]);

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
      <Image source={source} style={sheetStyle} resizeMode="stretch" fadeDuration={0} />
    </View>
  );
}

const styles = StyleSheet.create(() => ({
  window: {
    overflow: "hidden",
  },
}));
