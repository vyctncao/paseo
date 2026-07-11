import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Codex-compatible custom pets live at `${CODEX_HOME:-~/.codex}/pets/<id>/`,
 * as a `pet.json` manifest beside a spritesheet. Paseo also exposes a small set
 * of original, code-drawn presets so the companion works without Codex being
 * installed. No Codex application artwork is copied or redistributed.
 *
 * The atlas is a grid of 192x208 cells, 8 frames per row, one row per animation
 * state, in a fixed order defined by the Codex app contract. A 1536x1872 atlas
 * is v1 (9 states), while a 1536x2288 atlas is v2 (11 states).
 */

export const PET_CELL_WIDTH = 192;
export const PET_CELL_HEIGHT = 208;
export const PET_FRAMES_PER_ROW = 8;
export const PET_ATLAS_WIDTH = PET_CELL_WIDTH * PET_FRAMES_PER_ROW;
export const MAX_PET_ATLAS_BYTES = 8 * 1024 * 1024;
export const PET_IMPORT_JSON_LIMIT = "16mb";

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
export type PetSource = "preset" | "custom";

const V1_ATLAS_HEIGHT = PET_STATES_V1.length * PET_CELL_HEIGHT;
const V2_ATLAS_HEIGHT = 11 * PET_CELL_HEIGHT;

export interface CodexPet {
  id: string;
  displayName: string;
  description: string;
  spritesheetPath: string;
  spriteVersionNumber: 1 | 2;
  rows: number;
  source: PetSource;
}

export interface PetManifest {
  id?: unknown;
  displayName?: unknown;
  description?: unknown;
  spriteVersionNumber?: unknown;
  spritesheetPath?: unknown;
}

export interface ImportPetManifest {
  id?: string;
  displayName: string;
  description?: string;
  spriteVersionNumber?: 1 | 2;
  spritesheetPath?: string;
}

export interface ImportPetInput {
  manifest: ImportPetManifest;
  atlasBase64: string;
}

export type PetImportStatus = 400 | 409 | 413;

export class PetImportError extends Error {
  readonly status: PetImportStatus;

  constructor(message: string, status: PetImportStatus = 400) {
    super(message);
    this.name = "PetImportError";
    this.status = status;
  }
}

interface PetAtlasMetadata {
  extension: "png" | "webp";
  mimeType: "image/png" | "image/webp";
  width: number;
  height: number;
}

interface PresetPetDefinition {
  id: string;
  displayName: string;
  description: string;
  kind: "orbit" | "sprout" | "ember";
}

const PRESET_DEFINITIONS: readonly PresetPetDefinition[] = [
  {
    id: "paseo-orbit",
    displayName: "Orbit",
    description: "A bright blue robot that keeps every task in view.",
    kind: "orbit",
  },
  {
    id: "paseo-sprout",
    displayName: "Sprout",
    description: "A cheerful green sprout for growing new ideas.",
    kind: "sprout",
  },
  {
    id: "paseo-ember",
    displayName: "Ember",
    description: "A warm little flame that stays lively while work moves.",
    kind: "ember",
  },
];

export const PASEO_PRESET_PETS: readonly CodexPet[] = PRESET_DEFINITIONS.map((preset) => ({
  id: preset.id,
  displayName: preset.displayName,
  description: preset.description,
  spritesheetPath: "spritesheet.svg",
  spriteVersionNumber: 1,
  rows: PET_STATES_V1.length,
  source: "preset",
}));

const BOB = [0, -3, -6, -3, 0, 3, 6, 3] as const;
const SWAY = [-4, -2, 0, 2, 4, 2, 0, -2] as const;
const RUN = [-12, -8, -4, 0, 4, 8, 12, 8] as const;
const JUMP = [2, -8, -22, -36, -22, -8, 0, 3] as const;

function frameMotion(row: number, column: number): { dx: number; dy: number; rotation: number } {
  const bob = BOB[column] ?? 0;
  const sway = SWAY[column] ?? 0;
  switch (row) {
    case 1:
      return { dx: RUN[column] ?? 0, dy: column % 2 === 0 ? 2 : -3, rotation: sway / 2 };
    case 2:
      return { dx: -(RUN[column] ?? 0), dy: column % 2 === 0 ? 2 : -3, rotation: -sway / 2 };
    case 3:
      return { dx: sway / 2, dy: bob / 3, rotation: sway };
    case 4:
      return { dx: sway / 3, dy: JUMP[column] ?? 0, rotation: sway / 2 };
    case 5:
      return { dx: sway / 3, dy: 10 + Math.abs(bob) / 3, rotation: -6 + sway / 2 };
    case 6:
      return { dx: sway / 2, dy: Math.abs(bob) / 3, rotation: sway / 3 };
    case 7:
      return { dx: sway, dy: bob, rotation: sway / 2 };
    case 8:
      return { dx: sway / 3, dy: bob / 4, rotation: 5 + sway / 3 };
    default:
      return { dx: sway / 4, dy: bob / 2, rotation: sway / 4 };
  }
}

function orbitFrame(row: number, column: number): string {
  let armLift = 10 + (column % 2) * 4;
  if (row === 3) armLift = 36 + (column % 4) * 7;
  else if (row === 5) armLift = -4;
  let eyeHeight = 8;
  if (row === 5) eyeHeight = 2;
  else if (column % 4 === 1) eyeHeight = 5;
  return `<g stroke="#0b2657" stroke-width="6" stroke-linejoin="round">
    <line x1="0" y1="-57" x2="0" y2="-72"/><circle cx="0" cy="-78" r="8" fill="#7dd3fc"/>
    <rect x="-50" y="-58" width="100" height="70" rx="20" fill="#3182f6"/>
    <rect x="-38" y="-43" width="76" height="37" rx="14" fill="#102a56" stroke="none"/>
    <rect x="-22" y="-31" width="12" height="${eyeHeight}" rx="4" fill="#dff8ff" stroke="none"/>
    <rect x="10" y="-31" width="12" height="${eyeHeight}" rx="4" fill="#dff8ff" stroke="none"/>
    <rect x="-36" y="12" width="72" height="48" rx="18" fill="#60a5fa"/>
    <line x1="-36" y1="25" x2="-58" y2="${armLift}"/><line x1="36" y1="25" x2="58" y2="${22 - armLift / 4}"/>
    <line x1="-20" y1="58" x2="-25" y2="76"/><line x1="20" y1="58" x2="25" y2="76"/>
  </g>`;
}

function sproutFrame(row: number, column: number): string {
  const leafTilt = (SWAY[column] ?? 0) * (row === 7 ? 2 : 1);
  const mouth = row === 5 ? "M-10 27 Q0 18 10 27" : "M-11 23 Q0 34 11 23";
  return `<g stroke="#184f2b" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M0 -2 C0 -28 ${leafTilt} -44 0 -66" fill="none"/>
    <path d="M-2 -51 C-34 -68 -48 -50 -39 -32 C-21 -31 -8 -39 -2 -51Z" fill="#68d391"/>
    <path d="M3 -58 C29 -79 48 -64 43 -44 C27 -38 13 -44 3 -58Z" fill="#4ade80"/>
    <path d="M-48 0 H48 L38 63 Q0 79 -38 63Z" fill="#86c45b"/>
    <path d="M-53 0 H53 V18 H-53Z" fill="#a3d977"/>
    <circle cx="-17" cy="24" r="5" fill="#123c25" stroke="none"/><circle cx="17" cy="24" r="5" fill="#123c25" stroke="none"/>
    <path d="${mouth}" fill="none" stroke-width="5"/>
  </g>`;
}

function emberFrame(row: number, column: number): string {
  const flicker = (column % 4) * 3 + (row === 7 ? 7 : 0);
  const mouth = row === 5 ? "M-10 31 Q0 20 10 31" : "M-11 27 Q0 38 11 27";
  return `<g stroke="#7c2d12" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M0 ${-72 - flicker} C24 -50 17 -34 42 -21 C65 -7 67 31 46 58 C25 84 -25 84 -47 58 C-70 29 -57 -6 -34 -25 C-17 -39 -19 -55 0 ${-72 - flicker}Z" fill="#fb923c"/>
    <path d="M3 -34 C18 -15 7 -3 23 13 C40 31 27 57 4 61 C-21 62 -34 36 -22 17 C-12 2 -9 -16 3 -34Z" fill="#facc15" stroke="none"/>
    <circle cx="-17" cy="16" r="5" fill="#5b210d" stroke="none"/><circle cx="17" cy="16" r="5" fill="#5b210d" stroke="none"/>
    <path d="${mouth}" fill="none" stroke-width="5"/>
  </g>`;
}

function renderPresetSpritesheet(preset: PresetPetDefinition): string {
  const frames: string[] = [];
  for (let row = 0; row < PET_STATES_V1.length; row += 1) {
    for (let column = 0; column < PET_FRAMES_PER_ROW; column += 1) {
      const motion = frameMotion(row, column);
      const x = column * PET_CELL_WIDTH + PET_CELL_WIDTH / 2 + motion.dx;
      const y = row * PET_CELL_HEIGHT + PET_CELL_HEIGHT / 2 + motion.dy;
      let art: string;
      if (preset.kind === "orbit") art = orbitFrame(row, column);
      else if (preset.kind === "sprout") art = sproutFrame(row, column);
      else art = emberFrame(row, column);
      frames.push(
        `<g transform="translate(${x} ${y}) rotate(${motion.rotation})" data-row="${row}" data-frame="${column}">${art}</g>`,
      );
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PET_ATLAS_WIDTH}" height="${V1_ATLAS_HEIGHT}" viewBox="0 0 ${PET_ATLAS_WIDTH} ${V1_ATLAS_HEIGHT}" shape-rendering="geometricPrecision">${frames.join("")}</svg>`;
}

const PRESET_SPRITESHEETS = new Map(
  PRESET_DEFINITIONS.map((preset) => [preset.id, renderPresetSpritesheet(preset)]),
);

export function getPresetPetSpritesheet(petId: string): string | null {
  return PRESET_SPRITESHEETS.get(petId) ?? null;
}

export function resolveCodexPetsDir(env: NodeJS.ProcessEnv = process.env): string {
  const codexHome = env.CODEX_HOME?.trim();
  return path.join(
    codexHome && codexHome.length > 0 ? codexHome : path.join(homedir(), ".codex"),
    "pets",
  );
}

/** WebP dimensions without pulling in an image decoder. */
export function readWebpDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 20) return null;
  if (buffer.toString("ascii", 0, 4) !== "RIFF") return null;
  if (buffer.toString("ascii", 8, 12) !== "WEBP") return null;
  if (buffer.readUInt32LE(4) + 8 > buffer.length) return null;

  let chunkOffset = 12;
  while (chunkOffset + 8 <= buffer.length) {
    const chunk = buffer.toString("ascii", chunkOffset, chunkOffset + 4);
    const chunkLength = buffer.readUInt32LE(chunkOffset + 4);
    const dataOffset = chunkOffset + 8;
    if (dataOffset + chunkLength > buffer.length) return null;

    if (chunk === "VP8X" && chunkLength >= 10) {
      return {
        width: 1 + buffer.readUIntLE(dataOffset + 4, 3),
        height: 1 + buffer.readUIntLE(dataOffset + 7, 3),
      };
    }
    if (chunk === "VP8L" && chunkLength >= 5 && buffer[dataOffset] === 0x2f) {
      const bits = buffer.readUInt32LE(dataOffset + 1);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
    if (
      chunk === "VP8 " &&
      chunkLength >= 10 &&
      buffer[dataOffset + 3] === 0x9d &&
      buffer[dataOffset + 4] === 0x01 &&
      buffer[dataOffset + 5] === 0x2a
    ) {
      return {
        width: buffer.readUInt16LE(dataOffset + 6) & 0x3fff,
        height: buffer.readUInt16LE(dataOffset + 8) & 0x3fff,
      };
    }

    chunkOffset = dataOffset + chunkLength + (chunkLength % 2);
  }
  return null;
}

export function readPngDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 33) return null;
  if (buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return null;
  if (buffer.readUInt32BE(8) !== 13) return null;
  if (buffer.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

export function readPetAtlasMetadata(buffer: Buffer): PetAtlasMetadata | null {
  const png = readPngDimensions(buffer);
  if (png) return { ...png, extension: "png", mimeType: "image/png" };
  const webp = readWebpDimensions(buffer);
  if (webp) return { ...webp, extension: "webp", mimeType: "image/webp" };
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
  if (path.isAbsolute(spritesheetPath) || spritesheetPath.split(/[\\/]/).includes("..")) {
    return null;
  }
  const declaredVersion =
    parsed.spriteVersionNumber === 1 || parsed.spriteVersionNumber === 2
      ? parsed.spriteVersionNumber
      : 1;
  return {
    id: typeof parsed.id === "string" && parsed.id.length > 0 ? parsed.id : fallbackId,
    displayName: typeof parsed.displayName === "string" ? parsed.displayName : fallbackId,
    description: typeof parsed.description === "string" ? parsed.description : "",
    spritesheetPath,
    spriteVersionNumber: declaredVersion,
    rows: declaredVersion === 2 ? 11 : PET_STATES_V1.length,
    source: "custom",
  };
}

function isPathWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative.length > 0 && relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

/** Absolute path to a custom pet's spritesheet, or null when the id/path is unsafe. */
export async function resolvePetSpritesheetPath(
  petId: string,
  petsDir: string = resolveCodexPetsDir(),
): Promise<string | null> {
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

  const candidate = path.resolve(dir, pet.spritesheetPath);
  try {
    const [realPetsDir, realPetDir, realCandidate, candidateStats] = await Promise.all([
      realpath(petsDir),
      realpath(dir),
      realpath(candidate),
      lstat(candidate),
    ]);
    if (!isPathWithin(realPetsDir, realPetDir)) return null;
    if (!isPathWithin(realPetDir, realCandidate)) return null;
    if (!candidateStats.isFile() || candidateStats.isSymbolicLink()) return null;
    return realCandidate;
  } catch {
    return null;
  }
}

/** Installed custom pets sorted by id, followed by Paseo's stable preset order. */
export async function listCodexPets(petsDir: string = resolveCodexPetsDir()): Promise<CodexPet[]> {
  let entries: string[];
  try {
    entries = (await readdir(petsDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name);
  } catch {
    return [...PASEO_PRESET_PETS];
  }

  const customPets: CodexPet[] = [];
  for (const directoryId of entries.sort()) {
    const dir = path.join(petsDir, directoryId);
    let manifestRaw: string;
    try {
      manifestRaw = await readFile(path.join(dir, "pet.json"), "utf8");
    } catch {
      continue;
    }
    const pet = parsePetManifest(manifestRaw, directoryId);
    if (!pet) continue;

    const spritesheetPath = await resolvePetSpritesheetPath(directoryId, petsDir);
    if (!spritesheetPath) continue;
    let sheet: Buffer;
    try {
      sheet = await readFile(spritesheetPath);
    } catch {
      continue;
    }
    const metadata = readPetAtlasMetadata(sheet);
    if (!metadata || metadata.width !== PET_ATLAS_WIDTH) continue;
    const version = resolveSpriteVersion(metadata.height);
    if (!version) continue;

    // Directory names are the stable routing key. A stale/mismatched manifest id
    // must not create a catalog id that `/api/pets/:id/spritesheet` cannot serve.
    customPets.push({
      ...pet,
      id: directoryId,
      spritesheetPath: path.basename(spritesheetPath),
      spriteVersionNumber: version.version,
      rows: version.rows,
      source: "custom",
    });
  }
  return [...customPets, ...PASEO_PRESET_PETS];
}

export function normalizePetId(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return normalized || "pet";
}

function requireImportManifestRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PetImportError("manifest must be an object");
  }
  return value as Record<string, unknown>;
}

function optionalManifestString(
  manifest: Record<string, unknown>,
  field: "id" | "description" | "spritesheetPath",
  maximumLength?: number,
): string | undefined {
  const value = manifest[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new PetImportError(`manifest.${field} must be a string`);
  if (maximumLength !== undefined && value.length > maximumLength) {
    throw new PetImportError(`manifest.${field} is too long`);
  }
  return value;
}

function optionalSpriteVersion(value: unknown): 1 | 2 | undefined {
  if (value === undefined) return undefined;
  if (value !== 1 && value !== 2) {
    throw new PetImportError("manifest.spriteVersionNumber must be 1 or 2");
  }
  return value;
}

function parseImportManifest(value: unknown): ImportPetManifest {
  const manifest = requireImportManifestRecord(value);
  const displayNameValue = manifest.displayName;
  if (typeof displayNameValue !== "string" || displayNameValue.trim().length === 0) {
    throw new PetImportError("manifest.displayName is required");
  }
  const displayName = displayNameValue.trim();
  if (displayName.length > 100) throw new PetImportError("manifest.displayName is too long");
  const id = optionalManifestString(manifest, "id");
  const description = optionalManifestString(manifest, "description", 500);
  const spritesheetPath = optionalManifestString(manifest, "spritesheetPath");
  const spriteVersionNumber = optionalSpriteVersion(manifest.spriteVersionNumber);
  return {
    id,
    displayName,
    description: description?.trim() ?? "",
    spriteVersionNumber,
    spritesheetPath,
  };
}

function decodeAtlasBase64(value: unknown): Buffer {
  if (typeof value !== "string" || value.length === 0) {
    throw new PetImportError("atlasBase64 is required");
  }
  const maximumEncodedLength = Math.ceil(MAX_PET_ATLAS_BYTES / 3) * 4;
  if (value.length > maximumEncodedLength) {
    throw new PetImportError("Pet atlas exceeds the 8 MiB limit", 413);
  }
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new PetImportError("atlasBase64 is not valid base64");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length === 0) throw new PetImportError("Pet atlas is empty");
  if (decoded.length > MAX_PET_ATLAS_BYTES) {
    throw new PetImportError("Pet atlas exceeds the 8 MiB limit", 413);
  }
  if (decoded.toString("base64") !== value) {
    throw new PetImportError("atlasBase64 is not canonical base64");
  }
  return decoded;
}

function chooseAvailablePetId(baseId: string, existingIds: ReadonlySet<string>): string {
  if (!existingIds.has(baseId)) return baseId;
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const suffixText = `-${suffix}`;
    const candidate = `${baseId.slice(0, 80 - suffixText.length)}${suffixText}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  throw new PetImportError("Unable to allocate a unique pet id", 409);
}

async function isRenameCollision(error: unknown, targetPath: string): Promise<boolean> {
  if (!error || typeof error !== "object") return false;
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "EEXIST" || code === "ENOTEMPTY") return true;
  // Windows may report a directory rename collision as EPERM/EACCES. Only
  // classify it as a collision when the destination actually appeared.
  if (code !== "EPERM" && code !== "EACCES") return false;
  try {
    await lstat(targetPath);
    return true;
  } catch {
    return false;
  }
}

/** Validate and atomically install one custom pet into CODEX_HOME. */
export async function importCodexPet(
  input: unknown,
  petsDir: string = resolveCodexPetsDir(),
): Promise<CodexPet> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new PetImportError("Request body must be an object");
  }
  const request = input as Record<string, unknown>;
  const manifest = parseImportManifest(request.manifest);
  const atlas = decodeAtlasBase64(request.atlasBase64);
  const metadata = readPetAtlasMetadata(atlas);
  if (!metadata) throw new PetImportError("Pet atlas must be a PNG or WebP image");
  if (metadata.width !== PET_ATLAS_WIDTH) {
    throw new PetImportError(`Pet atlas width must be exactly ${PET_ATLAS_WIDTH}px`);
  }
  const version = resolveSpriteVersion(metadata.height);
  if (!version) {
    throw new PetImportError(
      `Pet atlas height must be exactly ${V1_ATLAS_HEIGHT}px (v1) or ${V2_ATLAS_HEIGHT}px (v2)`,
    );
  }
  if (
    manifest.spriteVersionNumber !== undefined &&
    manifest.spriteVersionNumber !== version.version
  ) {
    throw new PetImportError("manifest.spriteVersionNumber does not match the atlas dimensions");
  }

  await mkdir(petsDir, { recursive: true, mode: 0o700 });
  const directoryEntries = await readdir(petsDir, { withFileTypes: true });
  const existingIds = new Set([
    ...PASEO_PRESET_PETS.map((pet) => pet.id),
    ...directoryEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
  ]);
  const requestedId = normalizePetId(manifest.id?.trim() || manifest.displayName);
  let petId = chooseAvailablePetId(requestedId, existingIds);

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const spritesheetPath = `spritesheet.${metadata.extension}`;
    const installedManifest = {
      id: petId,
      displayName: manifest.displayName,
      description: manifest.description ?? "",
      spriteVersionNumber: version.version,
      spritesheetPath,
    };
    const temporaryDir = await mkdtemp(path.join(petsDir, `.${petId}-${randomUUID()}-`));
    const targetDir = path.join(petsDir, petId);
    try {
      await Promise.all([
        writeFile(path.join(temporaryDir, spritesheetPath), atlas, { mode: 0o600 }),
        writeFile(
          path.join(temporaryDir, "pet.json"),
          `${JSON.stringify(installedManifest, null, 2)}\n`,
          {
            encoding: "utf8",
            mode: 0o600,
          },
        ),
      ]);
      await rename(temporaryDir, targetDir);
      return {
        ...installedManifest,
        rows: version.rows,
        source: "custom",
      };
    } catch (error) {
      await rm(temporaryDir, { recursive: true, force: true }).catch(() => undefined);
      if (!(await isRenameCollision(error, targetDir))) throw error;
      existingIds.add(petId);
      petId = chooseAvailablePetId(requestedId, existingIds);
    }
  }
  throw new PetImportError("Unable to allocate a unique pet id", 409);
}
