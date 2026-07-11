import { useCallback, useMemo, useState } from "react";
import { Alert, Text, View } from "react-native";
import { Plus, RotateCw } from "lucide-react-native";
import { useQueryClient } from "@tanstack/react-query";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { AgentPet } from "@/components/pet/agent-pet";
import { PASEO_COMPANION_PET_KEY } from "@/components/pet/pet-assignment";
import { petSpritesheetUrl } from "@/components/pet/pet-sprite";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useIsCompactFormFactor } from "@/constants/layout";
import { getDesktopHost, type DesktopPetImportResult } from "@/desktop/host";
import { importDesktopPetDirectory } from "@/desktop/pets/desktop-pet-bridge";
import {
  useCodexPets,
  type CodexPetSummary,
  type ImportCodexPetInput,
} from "@/hooks/use-codex-pets";
import {
  useServerHttpAuthorizationHeader,
  useServerHttpBaseUrl,
} from "@/hooks/use-server-http-base-url";
import {
  APP_SETTINGS_QUERY_KEY,
  DEFAULT_CLIENT_SETTINGS,
  MAX_PET_SIZE,
  MIN_PET_SIZE,
  parsePetSize,
  useAppSettings,
  type AppSettings,
} from "@/hooks/use-settings";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";

export type CustomPetDirectorySelection = DesktopPetImportResult;

function optionalManifestString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function customPetImportInputFromSelection(
  selection: CustomPetDirectorySelection,
): ImportCodexPetInput {
  const parsed = JSON.parse(selection.manifestText) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid pet manifest");
  }
  const manifest = parsed as Record<string, unknown>;
  const displayName = optionalManifestString(manifest.displayName);
  const atlasBase64 = selection.spritesheetBase64.trim();
  if (!displayName || !atlasBase64) {
    throw new Error("Pet manifest and spritesheet are required");
  }
  const spriteVersionNumber = manifest.spriteVersionNumber;
  if (spriteVersionNumber !== undefined && spriteVersionNumber !== 1 && spriteVersionNumber !== 2) {
    throw new Error("Unsupported pet sprite version");
  }

  return {
    manifest: {
      ...(optionalManifestString(manifest.id) ? { id: optionalManifestString(manifest.id) } : {}),
      displayName,
      ...(optionalManifestString(manifest.description)
        ? { description: optionalManifestString(manifest.description) }
        : {}),
      ...(spriteVersionNumber === 1 || spriteVersionNumber === 2 ? { spriteVersionNumber } : {}),
      ...(optionalManifestString(manifest.spritesheetPath)
        ? { spritesheetPath: optionalManifestString(manifest.spritesheetPath) }
        : {}),
    },
    atlasBase64,
  };
}

interface PetOptionProps {
  baseUrl: string;
  authorizationHeader: string | null;
  pet: CodexPetSummary;
  selected: boolean;
  currentlyShown: boolean;
  onSelect: (petId: string) => void;
}

function PetOption({
  baseUrl,
  authorizationHeader,
  pet,
  selected,
  currentlyShown,
  onSelect,
}: PetOptionProps) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => onSelect(pet.id), [onSelect, pet.id]);
  const optionStyle = useMemo(
    () => [styles.option, selected ? styles.optionSelected : null],
    [selected],
  );

  return (
    <View style={optionStyle} testID={`pet-option-${pet.id}`}>
      <View style={styles.preview} pointerEvents="none">
        <AgentPet
          spritesheetUrl={petSpritesheetUrl(baseUrl, pet.id)}
          rows={pet.rows}
          lifecycle={selected ? "completed" : "idle"}
          size={72}
          authorizationHeader={authorizationHeader}
          accessibilityLabel={pet.displayName}
        />
      </View>
      <View style={styles.optionCopy}>
        <Text style={styles.optionTitle}>{pet.displayName}</Text>
        {pet.description ? (
          <Text style={styles.optionDescription} numberOfLines={2}>
            {pet.description}
          </Text>
        ) : null}
        {!selected && currentlyShown ? (
          <Text style={styles.optionStatus}>{t("settings.pets.currentlyShown")}</Text>
        ) : null}
      </View>
      <Button
        variant="secondary"
        size="sm"
        disabled={selected}
        accessibilityLabel={t("settings.pets.selectAccessibility", { name: pet.displayName })}
        onPress={handlePress}
        testID={`pet-select-${pet.id}`}
      >
        {selected ? t("settings.pets.selected") : t("settings.pets.select")}
      </Button>
    </View>
  );
}

export function PetsSection({ serverId }: { serverId: string | null }) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const queryClient = useQueryClient();
  const baseUrl = useServerHttpBaseUrl(serverId);
  const authHeader = useServerHttpAuthorizationHeader(serverId);
  const { settings, updateSettings } = useAppSettings();
  const { pets, petForProvider, isLoading, error, refresh, importPet } = useCodexPets(
    baseUrl,
    authHeader,
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isAddingCustom, setIsAddingCustom] = useState(false);
  const currentPet = petForProvider(PASEO_COMPANION_PET_KEY, settings.selectedPetId);
  const savedPetAvailable = useMemo(
    () => settings.selectedPetId === null || pets.some((pet) => pet.id === settings.selectedPetId),
    [pets, settings.selectedPetId],
  );
  const canAddCustomPet = typeof getDesktopHost()?.pet?.importFromDirectory === "function";

  const handleSelect = useCallback(
    (selectedPetId: string) => {
      void updateSettings({ selectedPetId });
    },
    [updateSettings],
  );
  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    void refresh()
      .catch(() => undefined)
      .finally(() => setIsRefreshing(false));
  }, [refresh]);
  const handleAddCustom = useCallback(() => {
    setIsAddingCustom(true);
    void importDesktopPetDirectory()
      .then(async (selection) => {
        if (!selection) return undefined;
        const imported = await importPet(customPetImportInputFromSelection(selection));
        return updateSettings({ selectedPetId: imported.id });
      })
      .catch(() => {
        Alert.alert(
          t("settings.pets.addCustomErrorTitle"),
          t("settings.pets.addCustomErrorMessage"),
        );
      })
      .finally(() => setIsAddingCustom(false));
  }, [importPet, t, updateSettings]);
  const handleSizeChange = useCallback(
    (value: number) => {
      const petSize = parsePetSize(value);
      if (petSize === null) return;
      queryClient.setQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY, (current) => ({
        ...(current ?? DEFAULT_CLIENT_SETTINGS),
        petSize,
      }));
    },
    [queryClient],
  );
  const handleSizeComplete = useCallback(
    (value: number) => {
      const petSize = parsePetSize(value);
      if (petSize === null) return;
      handleSizeChange(petSize);
      void updateSettings({ petSize });
    },
    [handleSizeChange, updateSettings],
  );

  const headerActions = useMemo(
    () => (
      <View style={styles.headerActions}>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={RotateCw}
          loading={isRefreshing}
          disabled={!baseUrl}
          accessibilityLabel={t("settings.pets.refreshAccessibility")}
          onPress={handleRefresh}
          testID="pets-refresh"
        />
        {canAddCustomPet ? (
          <Button
            variant="secondary"
            size="sm"
            leftIcon={Plus}
            loading={isAddingCustom}
            disabled={!baseUrl}
            accessibilityLabel={t("settings.pets.addCustomAccessibility")}
            onPress={handleAddCustom}
            testID="pets-add-custom"
          >
            {t("settings.pets.addCustom")}
          </Button>
        ) : null}
      </View>
    ),
    [baseUrl, canAddCustomPet, handleAddCustom, handleRefresh, isAddingCustom, isRefreshing, t],
  );

  let body;
  if (!serverId) {
    body = <Text style={styles.emptyText}>{t("settings.pets.noHost")}</Text>;
  } else if (!baseUrl) {
    body = <Text style={styles.emptyText}>{t("settings.pets.unavailableTransport")}</Text>;
  } else if (isLoading) {
    body = <Text style={styles.emptyText}>{t("settings.pets.loading")}</Text>;
  } else if (error) {
    body = <Text style={styles.emptyText}>{t("settings.pets.unavailable")}</Text>;
  } else if (pets.length === 0) {
    body = <Text style={styles.emptyText}>{t("settings.pets.empty")}</Text>;
  } else {
    body = (
      <View style={settingsStyles.card}>
        {pets.map((pet, index) => {
          const selected =
            settings.selectedPetId === pet.id ||
            (settings.selectedPetId === null && currentPet?.id === pet.id);
          return (
            <View key={pet.id} style={index > 0 ? styles.optionBorder : null}>
              <PetOption
                baseUrl={baseUrl}
                authorizationHeader={authHeader}
                pet={pet}
                selected={selected}
                currentlyShown={!savedPetAvailable && currentPet?.id === pet.id}
                onSelect={handleSelect}
              />
            </View>
          );
        })}
      </View>
    );
  }

  const sizeAccessibilityLabel = t("settings.pets.sizeAccessibility", {
    size: settings.petSize,
  });
  const sizeAccessibilityValue = useMemo(
    () => ({ min: MIN_PET_SIZE, max: MAX_PET_SIZE, now: settings.petSize }),
    [settings.petSize],
  );
  const sizeRowStyle = useMemo(
    () => [settingsStyles.row, isCompact ? styles.sizeRowCompact : null],
    [isCompact],
  );
  const sizeControlStyle = useMemo(
    () => [styles.sizeControl, isCompact ? styles.sizeControlCompact : null],
    [isCompact],
  );

  return (
    <>
      <Text style={styles.intro}>{t("settings.pets.description")}</Text>
      {!savedPetAvailable && settings.selectedPetId && currentPet ? (
        <Text style={styles.fallbackNotice}>
          {t("settings.pets.unavailableSelection", {
            selected: settings.selectedPetId,
            current: currentPet.displayName,
          })}
        </Text>
      ) : null}
      <SettingsSection
        title={t("settings.pets.choose")}
        trailing={headerActions}
        testID="settings-pets-section"
      >
        {body}
      </SettingsSection>
      <SettingsSection title={t("settings.pets.appearance")} testID="settings-pet-size-section">
        <View style={settingsStyles.card}>
          <View style={sizeRowStyle}>
            <View style={styles.sizeCopy}>
              <Text style={settingsStyles.rowTitle}>{t("settings.pets.sizeLabel")}</Text>
              <Text style={settingsStyles.rowHint}>{t("settings.pets.sizeDescription")}</Text>
            </View>
            <View style={sizeControlStyle}>
              <Slider
                minimumValue={MIN_PET_SIZE}
                maximumValue={MAX_PET_SIZE}
                step={1}
                value={settings.petSize}
                onValueChange={handleSizeChange}
                onSlidingComplete={handleSizeComplete}
                accessibilityLabel={sizeAccessibilityLabel}
                accessibilityValue={sizeAccessibilityValue}
                style={styles.sizeSlider}
                testID="pet-size-slider"
              />
              <Text style={styles.sizeValue} accessibilityElementsHidden>
                {t("settings.pets.sizeValue", { size: settings.petSize })}
              </Text>
            </View>
          </View>
        </View>
      </SettingsSection>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  intro: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    marginBottom: theme.spacing[4],
  },
  fallbackNotice: {
    color: theme.colors.statusWarning,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    marginBottom: theme.spacing[4],
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[6],
  },
  option: {
    minHeight: 96,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  optionSelected: {
    backgroundColor: theme.colors.surface2,
  },
  optionBorder: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  preview: {
    width: 76,
    alignItems: "center",
    justifyContent: "center",
  },
  optionCopy: {
    flex: 1,
    minWidth: 0,
  },
  optionTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  optionDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: 18,
    marginTop: theme.spacing[1],
  },
  optionStatus: {
    color: theme.colors.accent,
    fontSize: theme.fontSize.xs,
    marginTop: theme.spacing[1],
  },
  sizeRowCompact: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: theme.spacing[3],
  },
  sizeCopy: {
    flex: 1,
    minWidth: 0,
  },
  sizeControl: {
    width: 248,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  sizeControlCompact: {
    width: "100%",
  },
  sizeSlider: {
    flex: 1,
  },
  sizeValue: {
    width: 56,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    textAlign: "right",
  },
}));
