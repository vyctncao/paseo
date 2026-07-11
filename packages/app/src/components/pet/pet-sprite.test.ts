import { describe, expect, it } from "vitest";
import {
  PET_CELL_HEIGHT,
  PET_CELL_WIDTH,
  PET_FRAMES_PER_ROW,
  PET_STATES,
  petFrameCount,
  petFrameDurationMs,
  petFrameRect,
  petSpritesheetUrl,
  petStateForLifecycle,
  petStateIsRenderable,
  petStateRow,
} from "./pet-sprite";

describe("petStateForLifecycle", () => {
  it("animates while the agent works", () => {
    expect(petStateForLifecycle("running")).toBe("running");
    expect(petStateForLifecycle("thinking")).toBe("running");
  });

  it("waves when the agent has just finished", () => {
    expect(petStateForLifecycle("completed")).toBe("waving");
  });

  it("waits when the agent needs input and fails on error", () => {
    expect(petStateForLifecycle("needs_input")).toBe("waiting");
    expect(petStateForLifecycle("error")).toBe("failed");
  });

  it("rests when idle", () => {
    expect(petStateForLifecycle("idle")).toBe("idle");
  });
});

describe("petStateRow", () => {
  it("matches the Codex app's fixed row order", () => {
    expect(PET_STATES.map(petStateRow)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(petStateRow("waving")).toBe(3);
    expect(petStateRow("running")).toBe(7);
  });
});

describe("petStateIsRenderable", () => {
  it("accepts every state on a v1 (9-row) and v2 (11-row) atlas", () => {
    for (const state of PET_STATES) {
      expect(petStateIsRenderable(state, 9)).toBe(true);
      expect(petStateIsRenderable(state, 11)).toBe(true);
    }
  });

  it("rejects a state past the end of a truncated atlas", () => {
    expect(petStateIsRenderable("review", 4)).toBe(false);
    expect(petStateIsRenderable("idle", 4)).toBe(true);
  });
});

describe("petFrameRect", () => {
  it("walks columns across the row for the state", () => {
    expect(petFrameRect("idle", 0, 9)).toEqual({ offsetX: 0, offsetY: 0 });
    expect(petFrameRect("idle", 1, 9)).toEqual({ offsetX: -PET_CELL_WIDTH, offsetY: 0 });
    expect(petFrameRect("waving", 0, 9)).toEqual({ offsetX: 0, offsetY: -3 * PET_CELL_HEIGHT });
  });

  it("wraps at each state's populated frame count", () => {
    expect(petFrameRect("running-right", PET_FRAMES_PER_ROW, 9)).toEqual(
      petFrameRect("running-right", 0, 9),
    );
    expect(petFrameRect("running", 6, 9)).toEqual(petFrameRect("running", 0, 9));
    expect(petFrameRect("waving", 5, 9)).toEqual(petFrameRect("waving", 1, 9));
  });

  it("falls back to idle when the atlas cannot render the state", () => {
    expect(petFrameRect("review", 0, 4)).toEqual(petFrameRect("idle", 0, 9));
  });
});

describe("pet animation timing", () => {
  it("uses only populated atlas columns", () => {
    expect(petFrameCount("idle")).toBe(6);
    expect(petFrameCount("waving")).toBe(4);
    expect(petFrameCount("jumping")).toBe(5);
    expect(petFrameCount("running-right")).toBe(PET_FRAMES_PER_ROW);
  });

  it("uses state-specific frame durations and wraps safely", () => {
    expect(petFrameDurationMs("idle", 0)).toBe(280);
    expect(petFrameDurationMs("idle", 5)).toBe(320);
    expect(petFrameDurationMs("idle", 6)).toBe(280);
    expect(petFrameDurationMs("waving", -1)).toBe(280);
  });
});

describe("petSpritesheetUrl", () => {
  it("builds the daemon route and escapes the pet id", () => {
    expect(petSpritesheetUrl("http://127.0.0.1:6768", "mofu")).toBe(
      "http://127.0.0.1:6768/api/pets/mofu/spritesheet",
    );
    expect(petSpritesheetUrl("http://h:1/", "a b")).toBe("http://h:1/api/pets/a%20b/spritesheet");
  });
});
