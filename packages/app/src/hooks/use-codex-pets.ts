import { useMemo } from "react";
import { useFetchQuery } from "@/data/query";
import { petIdForProvider } from "@/components/pet/pet-assignment";
import { petSpritesheetUrl } from "@/components/pet/pet-sprite";

export interface CodexPetSummary {
  id: string;
  displayName: string;
  spriteVersionNumber: 1 | 2;
  rows: number;
}

export interface ResolvedPet {
  spritesheetUrl: string;
  rows: number;
}

export function codexPetsQueryKey(baseUrl: string | null): readonly unknown[] {
  return ["codex-pets", baseUrl];
}

export async function fetchCodexPets(baseUrl: string): Promise<CodexPetSummary[]> {
  const response = await fetch(new URL("/api/pets", baseUrl).toString());
  if (!response.ok) return [];
  const body = (await response.json()) as { pets?: CodexPetSummary[] };
  return body.pets ?? [];
}

/**
 * Installed Codex pets on the daemon at `baseUrl`, plus a resolver from an agent
 * provider to the pet that represents it.
 *
 * Pets are optional: a daemon whose host has no Codex install returns an empty list,
 * and `petForProvider` then returns null. Callers render nothing rather than a
 * placeholder, so the absence of Codex is invisible rather than broken.
 */
export function useCodexPets(baseUrl: string | null): {
  pets: CodexPetSummary[];
  petForProvider: (provider: string) => ResolvedPet | null;
} {
  const query = useFetchQuery<CodexPetSummary[]>({
    queryKey: codexPetsQueryKey(baseUrl),
    enabled: Boolean(baseUrl),
    dataShape: "list",
    staleTimeMs: 5 * 60_000, // Pets change only when the user installs one.
    queryFn: async (): Promise<CodexPetSummary[]> => (baseUrl ? fetchCodexPets(baseUrl) : []),
  });

  const pets = useMemo(() => query.data ?? [], [query.data]);

  const petForProvider = useMemo(() => {
    const petIds = pets.map((pet) => pet.id);
    const rowsById = new Map(pets.map((pet) => [pet.id, pet.rows]));
    return (provider: string): ResolvedPet | null => {
      if (!baseUrl) return null;
      const petId = petIdForProvider({ provider, petIds });
      const rows = petId ? rowsById.get(petId) : undefined;
      if (!petId || rows === undefined) return null;
      return { spritesheetUrl: petSpritesheetUrl(baseUrl, petId), rows };
    };
  }, [baseUrl, pets]);

  return { pets, petForProvider };
}
