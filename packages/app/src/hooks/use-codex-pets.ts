import { useCallback, useMemo } from "react";
import { useFetchQuery } from "@/data/query";
import { petIdForProvider } from "@/components/pet/pet-assignment";
import { petSpritesheetUrl } from "@/components/pet/pet-sprite";

export interface CodexPetSummary {
  id: string;
  displayName: string;
  description?: string;
  spriteVersionNumber: 1 | 2;
  rows: number;
  source?: "preset" | "custom";
}

export interface ResolvedPet {
  id: string;
  displayName: string;
  spritesheetUrl: string;
  rows: number;
  source?: "preset" | "custom";
}

export interface ImportCodexPetManifest {
  id?: string;
  displayName: string;
  description?: string;
  spriteVersionNumber?: 1 | 2;
  spritesheetPath?: string;
}

export interface ImportCodexPetInput {
  manifest: ImportCodexPetManifest;
  atlasBase64: string;
}

interface PetRequestOptions {
  authHeader?: string | null;
  fetchImpl?: typeof fetch;
}

export function resolveCodexPet(input: {
  baseUrl: string | null;
  pets: readonly CodexPetSummary[];
  petId: string;
}): ResolvedPet | null {
  if (!input.baseUrl || input.pets.length === 0) return null;
  const summary = input.pets.find((pet) => pet.id === input.petId) ?? null;
  if (!summary) return null;
  return {
    id: summary.id,
    displayName: summary.displayName,
    spritesheetUrl: petSpritesheetUrl(input.baseUrl, summary.id),
    rows: summary.rows,
    ...(summary.source ? { source: summary.source } : {}),
  };
}

export function codexPetsQueryKey(baseUrl: string | null): readonly unknown[] {
  return ["codex-pets", baseUrl];
}

export async function fetchCodexPets(
  baseUrl: string,
  options: PetRequestOptions = {},
): Promise<CodexPetSummary[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(new URL("/api/pets", baseUrl).toString(), {
    headers: options.authHeader ? { Authorization: options.authHeader } : undefined,
  });
  if (!response.ok) {
    throw new Error(`Pet catalog request failed with status ${response.status}`);
  }
  const body = (await response.json()) as { pets?: CodexPetSummary[] };
  return body.pets ?? [];
}

export async function importCodexPet(
  baseUrl: string,
  input: ImportCodexPetInput,
  options: PetRequestOptions = {},
): Promise<CodexPetSummary> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.authHeader) headers.Authorization = options.authHeader;
  const response = await fetchImpl(new URL("/api/pets/import", baseUrl).toString(), {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`Pet import failed with status ${response.status}`);
  }
  const body = (await response.json()) as { pet?: CodexPetSummary };
  if (!body.pet) throw new Error("Pet import response did not include a pet");
  return body.pet;
}

/**
 * Paseo presets and installed Codex-compatible pets on the daemon at `baseUrl`,
 * plus selection, refresh, and authenticated import helpers.
 */
export function useCodexPets(
  baseUrl: string | null,
  authHeader: string | null = null,
): {
  pets: CodexPetSummary[];
  petForProvider: (provider: string, preferredPetId?: string | null) => ResolvedPet | null;
  petForId: (petId: string | null) => ResolvedPet | null;
  refresh: () => Promise<void>;
  importPet: (input: ImportCodexPetInput) => Promise<CodexPetSummary>;
  isLoading: boolean;
  error: unknown;
} {
  const query = useFetchQuery<CodexPetSummary[]>({
    queryKey: codexPetsQueryKey(baseUrl),
    enabled: Boolean(baseUrl),
    dataShape: "list",
    staleTimeMs: 5 * 60_000, // Pets change only when the user installs one.
    queryFn: async (): Promise<CodexPetSummary[]> =>
      baseUrl ? fetchCodexPets(baseUrl, { authHeader }) : [],
  });

  const pets = useMemo(() => query.data ?? [], [query.data]);
  const refetch = query.refetch;

  const petForProvider = useMemo(() => {
    const petIds = pets.map((pet) => pet.id);
    const petsById = new Map(pets.map((pet) => [pet.id, pet]));
    return (provider: string, preferredPetId?: string | null): ResolvedPet | null => {
      if (!baseUrl) return null;
      const petId = petIdForProvider({
        provider,
        petIds,
        overrides: preferredPetId ? { [provider]: preferredPetId } : undefined,
      });
      const pet = petId ? petsById.get(petId) : undefined;
      if (!pet) return null;
      return {
        id: pet.id,
        displayName: pet.displayName,
        spritesheetUrl: petSpritesheetUrl(baseUrl, pet.id),
        rows: pet.rows,
        ...(pet.source ? { source: pet.source } : {}),
      };
    };
  }, [baseUrl, pets]);

  const petForId = useMemo(
    () =>
      (petId: string | null): ResolvedPet | null =>
        petId ? resolveCodexPet({ baseUrl, pets, petId }) : null,
    [baseUrl, pets],
  );

  const refresh = useCallback(async (): Promise<void> => {
    await refetch();
  }, [refetch]);

  const importPet = useCallback(
    async (input: ImportCodexPetInput): Promise<CodexPetSummary> => {
      if (!baseUrl) throw new Error("A direct host connection is required to import a pet");
      const pet = await importCodexPet(baseUrl, input, { authHeader });
      await refetch();
      return pet;
    },
    [authHeader, baseUrl, refetch],
  );

  return {
    pets,
    petForProvider,
    petForId,
    refresh,
    importPet,
    isLoading: query.isLoading,
    error: query.error,
  };
}
