/**
 * Which installed pet represents which agent provider.
 *
 * Automatic assignment must be stable: the same provider gets the same pet across
 * reloads and clients. Hashing the provider id into the sorted pet list gives that
 * for free. An explicit `overrides` map takes precedence for saved picker choices.
 */

export interface PetAssignmentInput {
  provider: string;
  /** Installed pet ids. Order must be stable; the daemon returns them sorted. */
  petIds: readonly string[];
  overrides?: Readonly<Record<string, string>>;
}

/** Stable assignment key for Paseo's one app-wide on-screen companion. */
export const PASEO_COMPANION_PET_KEY = "paseo-companion";

/** FNV-1a. Small, stable across platforms, and good enough to spread a handful of providers. */
export function hashProvider(provider: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < provider.length; index += 1) {
    hash ^= provider.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** The pet id for `provider`, or null when no pets are installed. */
export function petIdForProvider(input: PetAssignmentInput): string | null {
  const override = input.overrides?.[input.provider];
  if (override && input.petIds.includes(override)) return override;
  if (input.petIds.length === 0) return null;
  return input.petIds[hashProvider(input.provider) % input.petIds.length] ?? null;
}
