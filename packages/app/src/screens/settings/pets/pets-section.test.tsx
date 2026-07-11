/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CodexPetSummary, ResolvedPet } from "@/hooks/use-codex-pets";
import {
  customPetImportInputFromSelection,
  PetsSection,
  type CustomPetDirectorySelection,
} from "./pets-section";

const {
  alertMock,
  desktopState,
  hookState,
  importPetMock,
  refreshMock,
  setQueryDataMock,
  sliderState,
  updateSettingsMock,
  theme,
} = vi.hoisted(() => ({
  alertMock: vi.fn(),
  desktopState: {
    selectCustomPetDirectory: vi.fn<() => Promise<CustomPetDirectorySelection | null>>(),
  },
  hookState: {
    baseUrl: "http://127.0.0.1:6768" as string | null,
    selectedPetId: "nova" as string | null,
    petSize: 112,
    pets: [] as CodexPetSummary[],
    currentPet: null as ResolvedPet | null,
    isLoading: false,
    error: null as unknown,
  },
  importPetMock: vi.fn(),
  refreshMock: vi.fn(async () => undefined),
  setQueryDataMock: vi.fn(),
  sliderState: {
    onValueChange: null as ((value: number) => void) | null,
    onSlidingComplete: null as ((value: number) => void) | null,
  },
  updateSettingsMock: vi.fn(async () => undefined),
  theme: {
    spacing: { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24 },
    fontSize: { xs: 11, sm: 13, base: 15 },
    fontWeight: { normal: "400" },
    colors: {
      foreground: "#fff",
      foregroundMuted: "#aaa",
      surface2: "#222",
      border: "#555",
      accent: "#0a84ff",
      statusWarning: "#ff9500",
    },
  },
}));

vi.mock("react-native", () => ({
  Alert: { alert: alertMock },
  View: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("div", { "data-testid": testID }, children),
  Text: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("span", null, children),
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) =>
      typeof factory === "function"
        ? (factory as (value: typeof theme) => unknown)(theme)
        : factory,
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>) => {
      const copy: Record<string, string> = {
        "settings.pets.description": "Choose the pet that stays with you across Paseo.",
        "settings.pets.choose": "Choose a pet",
        "settings.pets.selected": "Selected",
        "settings.pets.select": "Select",
        "settings.pets.currentlyShown": "Currently shown",
        "settings.pets.noHost": "Connect a host to see its pets.",
        "settings.pets.unavailableTransport": "Pets are unavailable for this connection.",
        "settings.pets.loading": "Loading pets…",
        "settings.pets.unavailable": "Pets couldn't be loaded from this host.",
        "settings.pets.empty": "No pets are installed on this host.",
        "settings.pets.refreshAccessibility": "Refresh pets",
        "settings.pets.addCustom": "Add custom",
        "settings.pets.addCustomAccessibility": "Add a custom pet",
        "settings.pets.addCustomErrorTitle": "Couldn't add pet",
        "settings.pets.addCustomErrorMessage": "Check the pet folder and try again.",
        "settings.pets.appearance": "Appearance",
        "settings.pets.sizeLabel": "Pet size",
        "settings.pets.sizeDescription": "Adjust the size of your on-screen pet",
      };
      if (key === "settings.pets.selectAccessibility") return `Select ${values?.name}`;
      if (key === "settings.pets.unavailableSelection") {
        return `${values?.selected} is unavailable; showing ${values?.current}.`;
      }
      if (key === "settings.pets.sizeAccessibility") return `Pet size: ${values?.size} pixels`;
      if (key === "settings.pets.sizeValue") return `${values?.size} px`;
      return copy[key] ?? key;
    },
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ setQueryData: setQueryDataMock }),
}));

vi.mock("lucide-react-native", () => ({
  Plus: () => null,
  RotateCw: () => null,
}));

vi.mock("@/components/pet/agent-pet", () => ({
  AgentPet: ({ accessibilityLabel }: { accessibilityLabel: string }) =>
    React.createElement("span", { "data-testid": `agent-pet-${accessibilityLabel}` }),
}));

vi.mock("@/components/pet/pet-assignment", () => ({
  PASEO_COMPANION_PET_KEY: "paseo-companion",
}));

vi.mock("@/components/pet/pet-sprite", () => ({
  petSpritesheetUrl: (baseUrl: string, petId: string) => `${baseUrl}/api/pets/${petId}/spritesheet`,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    disabled,
    accessibilityLabel,
    onPress,
    testID,
  }: {
    children?: React.ReactNode;
    disabled?: boolean;
    accessibilityLabel?: string;
    onPress?: () => void;
    testID?: string;
  }) =>
    React.createElement(
      "button",
      {
        type: "button",
        disabled,
        "aria-label": accessibilityLabel,
        "data-testid": testID,
        onClick: onPress,
      },
      children,
    ),
}));

vi.mock("@/components/ui/slider", () => ({
  Slider: ({
    value,
    onValueChange,
    onSlidingComplete,
    testID,
  }: {
    value: number;
    onValueChange: (value: number) => void;
    onSlidingComplete: (value: number) => void;
    testID?: string;
  }) => {
    sliderState.onValueChange = onValueChange;
    sliderState.onSlidingComplete = onSlidingComplete;
    return React.createElement("input", {
      type: "range",
      value,
      readOnly: true,
      "data-testid": testID,
    });
  },
}));

vi.mock("@/constants/layout", () => ({
  useIsCompactFormFactor: () => false,
}));

vi.mock("@/desktop/host", () => ({
  getDesktopHost: () => ({ pet: { importFromDirectory: vi.fn() } }),
}));

vi.mock("@/desktop/pets/desktop-pet-bridge", () => ({
  importDesktopPetDirectory: () => desktopState.selectCustomPetDirectory(),
}));

vi.mock("@/hooks/use-server-http-base-url", () => ({
  useServerHttpBaseUrl: () => hookState.baseUrl,
  useServerHttpAuthorizationHeader: () => null,
}));

vi.mock("@/hooks/use-settings", () => ({
  APP_SETTINGS_QUERY_KEY: ["app-settings"],
  DEFAULT_CLIENT_SETTINGS: { selectedPetId: null, petSize: 112 },
  MIN_PET_SIZE: 80,
  MAX_PET_SIZE: 224,
  parsePetSize: (value: unknown) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.min(224, Math.max(80, Math.floor(value)))
      : null,
  useAppSettings: () => ({
    settings: { selectedPetId: hookState.selectedPetId, petSize: hookState.petSize },
    updateSettings: updateSettingsMock,
  }),
}));

vi.mock("@/hooks/use-codex-pets", () => ({
  useCodexPets: () => ({
    pets: hookState.pets,
    petForProvider: () => hookState.currentPet,
    petForId: () => null,
    isLoading: hookState.isLoading,
    error: hookState.error,
    refresh: refreshMock,
    importPet: importPetMock,
  }),
}));

vi.mock("@/screens/settings/settings-section", () => ({
  SettingsSection: ({
    title,
    trailing,
    testID,
    children,
  }: {
    title: string;
    trailing?: React.ReactNode;
    testID?: string;
    children: React.ReactNode;
  }) => React.createElement("section", { "data-testid": testID }, title, trailing, children),
}));

vi.mock("@/styles/settings", () => ({
  settingsStyles: { card: {}, row: {}, rowTitle: {}, rowHint: {} },
}));

const pets: CodexPetSummary[] = [
  {
    id: "mofu",
    displayName: "Mofu",
    description: "A curious fox.",
    spriteVersionNumber: 1,
    rows: 9,
    source: "custom",
  },
  {
    id: "nova",
    displayName: "Nova",
    description: "A bright little companion.",
    spriteVersionNumber: 2,
    rows: 11,
    source: "preset",
  },
];

function resolvedPet(pet: CodexPetSummary): ResolvedPet {
  return {
    id: pet.id,
    displayName: pet.displayName,
    spritesheetUrl: `http://127.0.0.1:6768/api/pets/${pet.id}/spritesheet`,
    rows: pet.rows,
    source: pet.source,
  };
}

describe("customPetImportInputFromSelection", () => {
  it("accepts older manifests whose atlas version must be inferred by the host", () => {
    expect(
      customPetImportInputFromSelection({
        manifestText: JSON.stringify({
          id: "mofu",
          displayName: "Mofu",
          description: "A fluffy companion.",
          spritesheetPath: "spritesheet.webp",
        }),
        spritesheetBase64: "  YXRsYXM=  ",
        fileName: "spritesheet.webp",
      }),
    ).toEqual({
      manifest: {
        id: "mofu",
        displayName: "Mofu",
        description: "A fluffy companion.",
        spritesheetPath: "spritesheet.webp",
      },
      atlasBase64: "YXRsYXM=",
    });
  });

  it("rejects malformed manifests before sending bytes to the host", () => {
    expect(() =>
      customPetImportInputFromSelection({
        manifestText: JSON.stringify({ displayName: "Mofu", spriteVersionNumber: 3 }),
        spritesheetBase64: "YXRsYXM=",
        fileName: "spritesheet.webp",
      }),
    ).toThrow("Unsupported pet sprite version");
  });
});

describe("PetsSection", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    hookState.baseUrl = "http://127.0.0.1:6768";
    hookState.selectedPetId = "nova";
    hookState.petSize = 112;
    hookState.pets = pets;
    hookState.currentPet = resolvedPet(pets[1]);
    hookState.isLoading = false;
    hookState.error = null;
    updateSettingsMock.mockReset();
    updateSettingsMock.mockResolvedValue(undefined);
    refreshMock.mockReset();
    refreshMock.mockResolvedValue(undefined);
    importPetMock.mockReset();
    importPetMock.mockResolvedValue(pets[0]);
    desktopState.selectCustomPetDirectory.mockReset();
    desktopState.selectCustomPetDirectory.mockResolvedValue(null);
    alertMock.mockReset();
    setQueryDataMock.mockReset();
    sliderState.onValueChange = null;
    sliderState.onSlidingComplete = null;
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    root = null;
    container?.remove();
    container = null;
    vi.unstubAllGlobals();
  });

  function render(serverId: string | null = "local"): void {
    act(() => {
      root?.render(<PetsSection serverId={serverId} />);
    });
  }

  function byTestId(testID: string): HTMLElement | null {
    return container?.querySelector<HTMLElement>(`[data-testid="${testID}"]`) ?? null;
  }

  it("renders installed pets with row-level Select and Selected actions", () => {
    render();

    expect(container?.textContent).toContain("Mofu");
    expect(container?.textContent).toContain("Nova");
    expect(byTestId("agent-pet-Mofu")).not.toBeNull();
    expect(byTestId("agent-pet-Nova")).not.toBeNull();
    expect(byTestId("pet-select-mofu")?.textContent).toBe("Select");
    expect(byTestId("pet-select-mofu")?.hasAttribute("disabled")).toBe(false);
    expect(byTestId("pet-select-nova")?.textContent).toBe("Selected");
    expect(byTestId("pet-select-nova")?.hasAttribute("disabled")).toBe(true);
  });

  it("persists a newly selected pet", () => {
    render();

    act(() => {
      byTestId("pet-select-mofu")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(updateSettingsMock).toHaveBeenCalledWith({ selectedPetId: "mofu" });
  });

  it("refreshes the host pet catalog", async () => {
    render();

    await act(async () => {
      byTestId("pets-refresh")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("imports and selects a custom pet chosen by the desktop bridge", async () => {
    desktopState.selectCustomPetDirectory.mockResolvedValue({
      manifestText: JSON.stringify({ displayName: "Cloud", spriteVersionNumber: 2 }),
      spritesheetBase64: "Y2xvdWQ=",
      fileName: "cloud.webp",
    });
    importPetMock.mockResolvedValue({ ...pets[1], id: "cloud", displayName: "Cloud" });
    render();

    await act(async () => {
      byTestId("pets-add-custom")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(importPetMock).toHaveBeenCalledWith({
      manifest: { displayName: "Cloud", spriteVersionNumber: 2 },
      atlasBase64: "Y2xvdWQ=",
    });
    expect(updateSettingsMock).toHaveBeenCalledWith({ selectedPetId: "cloud" });
  });

  it("previews pet size in memory and persists it when sliding completes", () => {
    render();

    act(() => sliderState.onValueChange?.(160));
    expect(setQueryDataMock).toHaveBeenCalledTimes(1);
    const updateCache = setQueryDataMock.mock.calls[0]?.[1] as
      | ((current: undefined) => { petSize: number })
      | undefined;
    expect(updateCache?.(undefined).petSize).toBe(160);

    act(() => sliderState.onSlidingComplete?.(160));
    expect(updateSettingsMock).toHaveBeenCalledWith({ petSize: 160 });
  });

  it.each([
    {
      label: "missing host",
      serverId: null,
      baseUrl: "http://127.0.0.1:6768",
      installedPets: pets,
      expected: "Connect a host to see its pets.",
    },
    {
      label: "connection without HTTP pet access",
      serverId: "relay",
      baseUrl: null,
      installedPets: pets,
      expected: "Pets are unavailable for this connection.",
    },
    {
      label: "host without installed pets",
      serverId: "local",
      baseUrl: "http://127.0.0.1:6768",
      installedPets: [],
      expected: "No pets are installed on this host.",
    },
  ])("shows the $label state", ({ serverId, baseUrl, installedPets, expected }) => {
    hookState.baseUrl = baseUrl;
    hookState.pets = installedPets;
    hookState.currentPet = null;

    render(serverId);

    expect(container?.textContent).toContain(expected);
    expect(container?.querySelector('[data-testid^="pet-option-"]')).toBeNull();
  });

  it("distinguishes a failed catalog request from a host with no installed pets", () => {
    hookState.error = new Error("Unauthorized");
    hookState.pets = [];
    hookState.currentPet = null;

    render();

    expect(container?.textContent).toContain("Pets couldn't be loaded from this host.");
    expect(container?.textContent).not.toContain("No pets are installed on this host.");
  });
});
