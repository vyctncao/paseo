import { describe, expect, it } from "vitest";
import { hashProvider, petIdForProvider } from "./pet-assignment";

const PETS = ["aoi", "mofu", "nova"];

describe("hashProvider", () => {
  it("is deterministic and differs across providers", () => {
    expect(hashProvider("claude")).toBe(hashProvider("claude"));
    expect(hashProvider("claude")).not.toBe(hashProvider("codex"));
  });
});

describe("petIdForProvider", () => {
  it("returns null when no pets are installed", () => {
    expect(petIdForProvider({ provider: "claude", petIds: [] })).toBeNull();
  });

  it("always assigns an installed pet to built-in and custom providers", () => {
    for (const provider of ["claude", "codex", "opencode", "copilot", "pi", "omp", "custom-qwen"]) {
      expect(PETS).toContain(petIdForProvider({ provider, petIds: PETS }));
    }
  });

  it("is stable for the same provider and pet list", () => {
    const first = petIdForProvider({ provider: "codex", petIds: PETS });
    const second = petIdForProvider({ provider: "codex", petIds: PETS });
    expect(first).toBe(second);
  });

  it("gives a single installed pet to every provider", () => {
    expect(petIdForProvider({ provider: "claude", petIds: ["mofu"] })).toBe("mofu");
    expect(petIdForProvider({ provider: "codex", petIds: ["mofu"] })).toBe("mofu");
  });

  it("honors an override", () => {
    expect(
      petIdForProvider({ provider: "claude", petIds: PETS, overrides: { claude: "nova" } }),
    ).toBe("nova");
  });

  it("ignores an override naming a pet that is not installed", () => {
    const assigned = petIdForProvider({
      provider: "claude",
      petIds: PETS,
      overrides: { claude: "ghost" },
    });
    expect(assigned).not.toBe("ghost");
    expect(PETS).toContain(assigned);
  });
});
