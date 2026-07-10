/**
 * Codex pet spritesheet geometry and the mapping from Paseo's agent lifecycle to
 * the atlas row the pet should be animating.
 *
 * The atlas is a grid of 192x208 cells, 8 frames per row, one row per animation
 * state, in the fixed order the Codex app contract defines. `pet.json` does not
 * record the row count, so the daemon derives the sprite version from the image
 * height and sends `rows` along with each pet.
 */

export const PET_CELL_WIDTH = 192;
export const PET_CELL_HEIGHT = 208;
export const PET_FRAMES_PER_ROW = 8;

export const PET_STATES = [
  "idle",
  "running-right",
  "running-left",
  "waving",
  "jumping",
  "failed",
  "waiting",
  "running",
  "review",
] as const;

export type PetState = (typeof PET_STATES)[number];

/** The agent lifecycle values a pet reacts to. */
export type AgentPetLifecycle =
  | "idle"
  | "running"
  | "thinking"
  | "needs_input"
  | "error"
  | "completed";

/**
 * How long the celebratory `waving` state plays after an agent finishes before the
 * pet settles back to `idle`. This is the "it's done" signal.
 */
export const PET_WAVE_DURATION_MS = 4_000;

export const PET_FRAME_DURATION_MS = 120;

export function petStateForLifecycle(lifecycle: AgentPetLifecycle): PetState {
  switch (lifecycle) {
    case "running":
    case "thinking":
      return "running";
    case "needs_input":
      return "waiting";
    case "error":
      return "failed";
    case "completed":
      return "waving";
    case "idle":
      return "idle";
  }
}

export function petStateRow(state: PetState): number {
  return PET_STATES.indexOf(state);
}

/**
 * Whether an atlas with `rows` rows can render `state`. A v1 atlas has 9 rows; a
 * v2 atlas has 11. Every state in PET_STATES exists in both, so this only guards
 * against a truncated or unrecognized sheet.
 */
export function petStateIsRenderable(state: PetState, rows: number): boolean {
  const row = petStateRow(state);
  return row >= 0 && row < rows;
}

export interface PetFrameRect {
  /** Pixel offset to translate the spritesheet by, so the frame lands in the cell. */
  offsetX: number;
  offsetY: number;
}

/**
 * Top-left offset of `frame` within `state`'s row, wrapping so an ever-increasing
 * frame counter loops the row.
 */
export function petFrameRect(state: PetState, frame: number, rows: number): PetFrameRect {
  const safeState = petStateIsRenderable(state, rows) ? state : "idle";
  const column = ((frame % PET_FRAMES_PER_ROW) + PET_FRAMES_PER_ROW) % PET_FRAMES_PER_ROW;
  // `|| 0` normalizes the -0 that negating a zero column/row would otherwise yield.
  return {
    offsetX: -(column * PET_CELL_WIDTH) || 0,
    offsetY: -(petStateRow(safeState) * PET_CELL_HEIGHT) || 0,
  };
}

/** `/api/pets/:id/spritesheet` on the daemon that owns the pet. */
export function petSpritesheetUrl(baseUrl: string, petId: string): string {
  return new URL(`/api/pets/${encodeURIComponent(petId)}/spritesheet`, baseUrl).toString();
}
