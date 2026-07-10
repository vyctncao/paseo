import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Codex pets are pixel-art companions installed by the Codex CLI at
 * `${CODEX_HOME:-~/.codex}/pets/<id>/`, as a `pet.json` manifest beside a
 * spritesheet. Paseo reads them in place; it never bundles or copies the art.
 *
 * The atlas is a grid of 192x208 cells, 8 frames per row, one row per animation
 * state, in a fixed order defined by the Codex app contract. `pet.json` does NOT
 * record the row count, so the sprite version is derived from the image height:
 * a 1872px atlas is v1 (9 states), 2288px is v2 (11 states). That is the same
 * check codex-pets.net makes.
 */

export const PET_CELL_WIDTH = 192;
export const PET_CELL_HEIGHT = 208;
export const PET_FRAMES_PER_ROW = 8;

// Row order is the Codex app contract. Index is the atlas row.
export const PET_STATES_V1 = [
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

export type PetState = (typeof PET_STATES_V1)[number];

const V1_ATLAS_HEIGHT = PET_STATES_V1.length * PET_CELL_HEIGHT; // 1872
const V2_ATLAS_HEIGHT = 11 * PET_CELL_HEIGHT; // 2288

export interface CodexPet {
  id: string;
  displayName: string;
  description: string;
  spritesheetPath: string;
  spriteVersionNumber: 1 | 2;
  rows: number;
}

export interface PetManifest {
  id?: unknown;
  displayName?: unknown;
  description?: unknown;
  spritesheetPath?: unknown;
}

export function resolveCodexPetsDir(env: NodeJS.ProcessEnv = process.env): string {
  const codexHome = env.CODEX_HOME?.trim();
  return path.join(
    codexHome && codexHome.length > 0 ? codexHome : path.join(homedir(), ".codex"),
    "pets",
  );
}

/**
 * WebP dimensions. Only the VP8/VP8L/VP8X chunk headers are read — enough to tell
 * a v1 atlas from a v2 one without pulling in an image decoder.
 */
export function readWebpDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 30) return null;
  if (buffer.toString("ascii", 0, 4) !== "RIFF") return null;
  if (buffer.toString("ascii", 8, 12) !== "WEBP") return null;

  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8X") {
    // 24-bit little-endian, stored as (dimension - 1).
    const width = 1 + (buffer[24]! | (buffer[25]! << 8) | (buffer[26]! << 16));
    const height = 1 + (buffer[27]! | (buffer[28]! << 8) | (buffer[29]! << 16));
    return { width, height };
  }
  if (chunk === "VP8 ") {
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    const bits = buffer.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  return null;
}

export function resolveSpriteVersion(atlasHeight: number): { version: 1 | 2; rows: number } | null {
  if (atlasHeight === V1_ATLAS_HEIGHT) return { version: 1, rows: PET_STATES_V1.length };
  if (atlasHeight === V2_ATLAS_HEIGHT) return { version: 2, rows: 11 };
  return null;
}

export function parsePetManifest(raw: string, fallbackId: string): CodexPet | null {
  let parsed: PetManifest;
  try {
    parsed = JSON.parse(raw) as PetManifest;
  } catch {
    return null;
  }
  const spritesheetPath =
    typeof parsed.spritesheetPath === "string" && parsed.spritesheetPath.length > 0
      ? parsed.spritesheetPath
      : "spritesheet.webp";
  // `spritesheetPath` is joined onto the pet directory below, so it must not escape it.
  if (path.isAbsolute(spritesheetPath) || spritesheetPath.split(/[\\/]/).includes("..")) {
    return null;
  }
  return {
    id: typeof parsed.id === "string" && parsed.id.length > 0 ? parsed.id : fallbackId,
    displayName: typeof parsed.displayName === "string" ? parsed.displayName : fallbackId,
    description: typeof parsed.description === "string" ? parsed.description : "",
    spritesheetPath,
    spriteVersionNumber: 1,
    rows: PET_STATES_V1.length,
  };
}

/** Absolute path to a pet's spritesheet, or null when the id is unknown/unsafe. */
export async function resolvePetSpritesheetPath(
  petId: string,
  petsDir: string = resolveCodexPetsDir(),
): Promise<string | null> {
  // Reject traversal before touching the filesystem — petId arrives from an HTTP path param.
  if (petId.length === 0 || petId.includes("/") || petId.includes("\\") || petId.includes("..")) {
    return null;
  }
  const dir = path.join(petsDir, petId);
  let manifestRaw: string;
  try {
    manifestRaw = await readFile(path.join(dir, "pet.json"), "utf8");
  } catch {
    return null;
  }
  const pet = parsePetManifest(manifestRaw, petId);
  if (!pet) return null;

  const spritesheet = path.join(dir, pet.spritesheetPath);
  const resolved = path.resolve(spritesheet);
  if (!resolved.startsWith(path.resolve(dir) + path.sep)) return null;
  try {
    await stat(resolved);
  } catch {
    return null;
  }
  return resolved;
}

/**
 * Every installed pet, skipping directories whose manifest is missing/invalid or
 * whose spritesheet is not a recognized atlas. Returns [] when no pets are
 * installed — Codex not being present is normal, not an error.
 */
export async function listCodexPets(petsDir: string = resolveCodexPetsDir()): Promise<CodexPet[]> {
  let entries: string[];
  try {
    entries = (await readdir(petsDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }

  const pets: CodexPet[] = [];
  for (const id of entries.sort()) {
    const dir = path.join(petsDir, id);
    let manifestRaw: string;
    try {
      manifestRaw = await readFile(path.join(dir, "pet.json"), "utf8");
    } catch {
      continue;
    }
    const pet = parsePetManifest(manifestRaw, id);
    if (!pet) continue;

    let sheet: Buffer;
    try {
      sheet = await readFile(path.join(dir, pet.spritesheetPath));
    } catch {
      continue;
    }
    const dimensions = readWebpDimensions(sheet);
    if (!dimensions) continue;
    const version = resolveSpriteVersion(dimensions.height);
    if (!version) continue;

    pets.push({ ...pet, spriteVersionNumber: version.version, rows: version.rows });
  }
  return pets;
}
