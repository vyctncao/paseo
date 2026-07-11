import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

const MAX_PET_MANIFEST_BYTES = 64 * 1024;
const MAX_PET_SPRITESHEET_BYTES = 8 * 1024 * 1024;
const SUPPORTED_SPRITESHEET_EXTENSIONS = new Set([".png", ".webp"]);

export interface DesktopPetImport {
  manifestText: string;
  spritesheetBase64: string;
  fileName: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSpritesheetPath(manifestText: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestText);
  } catch {
    throw new Error("pet.json is not valid JSON.");
  }
  if (!isRecord(parsed)) {
    throw new Error("pet.json must contain an object.");
  }

  const configured = parsed.spritesheetPath;
  if (configured === undefined) {
    return "spritesheet.webp";
  }
  if (typeof configured !== "string" || configured.trim().length === 0) {
    throw new Error("pet.json spritesheetPath must be a non-empty string.");
  }
  return configured.trim();
}

function assertSupportedRelativeSpritesheetPath(filePath: string): void {
  if (path.isAbsolute(filePath)) {
    throw new Error("The pet spritesheet must be inside the selected folder.");
  }
  const segments = filePath.split(/[\\/]/);
  if (segments.some((segment) => segment === ".." || segment.length === 0)) {
    throw new Error("The pet spritesheet path is not safe.");
  }
  if (!SUPPORTED_SPRITESHEET_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    throw new Error("The pet spritesheet must be a PNG or WebP image.");
  }
}

function isInsideDirectory(directory: string, candidate: string): boolean {
  const relative = path.relative(directory, candidate);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * Reads a user-selected pet folder without installing it locally. The renderer
 * forwards these bytes to the active host, which owns validation and installation.
 */
export async function readDesktopPetImport(directoryPath: string): Promise<DesktopPetImport> {
  const selectedDirectory = await realpath(directoryPath);
  const manifestPath = path.join(selectedDirectory, "pet.json");
  const resolvedManifest = await realpath(manifestPath);
  if (!isInsideDirectory(selectedDirectory, resolvedManifest)) {
    throw new Error("pet.json must be inside the selected folder.");
  }
  const manifestStat = await stat(resolvedManifest);
  if (!manifestStat.isFile() || manifestStat.size > MAX_PET_MANIFEST_BYTES) {
    throw new Error("pet.json is missing or too large.");
  }

  const manifestText = await readFile(resolvedManifest, "utf8");
  const spritesheetPath = readSpritesheetPath(manifestText);
  assertSupportedRelativeSpritesheetPath(spritesheetPath);

  const resolvedSpritesheet = await realpath(path.resolve(selectedDirectory, spritesheetPath));
  if (!isInsideDirectory(selectedDirectory, resolvedSpritesheet)) {
    throw new Error("The pet spritesheet must be inside the selected folder.");
  }
  const spritesheetStat = await stat(resolvedSpritesheet);
  if (
    !spritesheetStat.isFile() ||
    spritesheetStat.size === 0 ||
    spritesheetStat.size > MAX_PET_SPRITESHEET_BYTES
  ) {
    throw new Error("The pet spritesheet is empty or too large.");
  }

  const spritesheet = await readFile(resolvedSpritesheet);
  return {
    manifestText,
    spritesheetBase64: spritesheet.toString("base64"),
    fileName: path.basename(resolvedSpritesheet),
  };
}
