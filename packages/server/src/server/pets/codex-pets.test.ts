import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  getPresetPetSpritesheet,
  importCodexPet,
  listCodexPets,
  MAX_PET_ATLAS_BYTES,
  normalizePetId,
  parsePetManifest,
  PASEO_PRESET_PETS,
  PET_ATLAS_WIDTH,
  PET_CELL_HEIGHT,
  PET_STATES_V1,
  PetImportError,
  readPetAtlasMetadata,
  readPngDimensions,
  readWebpDimensions,
  resolveCodexPetsDir,
  resolvePetSpritesheetPath,
  resolveSpriteVersion,
} from "./codex-pets.js";

/** Minimal VP8X WebP container. Only the dimension fields are meaningful. */
function makeWebp(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(32);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(24, 4);
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8X", 12, "ascii");
  buffer.writeUInt32LE(10, 16);
  const w = width - 1;
  const h = height - 1;
  buffer[24] = w & 0xff;
  buffer[25] = (w >> 8) & 0xff;
  buffer[26] = (w >> 16) & 0xff;
  buffer[27] = h & 0xff;
  buffer[28] = (h >> 8) & 0xff;
  buffer[29] = (h >> 16) & 0xff;
  return buffer;
}

/** Minimal PNG signature + IHDR dimensions. */
function makePng(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(33);
  Buffer.from("89504e470d0a1a0a", "hex").copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

const V1_HEIGHT = PET_STATES_V1.length * PET_CELL_HEIGHT;
const V2_HEIGHT = 11 * PET_CELL_HEIGHT;

let petsDir: string;

async function writePet(
  id: string,
  options: {
    manifest?: string;
    atlasHeight?: number | null;
    atlasWidth?: number;
    format?: "png" | "webp";
  } = {},
): Promise<void> {
  const dir = path.join(petsDir, id);
  await mkdir(dir, { recursive: true });
  const format = options.format ?? "webp";
  await writeFile(
    path.join(dir, "pet.json"),
    options.manifest ??
      JSON.stringify({
        id,
        displayName: id,
        description: "d",
        spritesheetPath: `spritesheet.${format}`,
      }),
  );
  if (options.atlasHeight !== null) {
    const width = options.atlasWidth ?? PET_ATLAS_WIDTH;
    const height = options.atlasHeight ?? V1_HEIGHT;
    await writeFile(
      path.join(dir, `spritesheet.${format}`),
      format === "png" ? makePng(width, height) : makeWebp(width, height),
    );
  }
}

beforeEach(async () => {
  petsDir = await mkdtemp(path.join(tmpdir(), "paseo-pets-"));
});

afterEach(async () => {
  await rm(petsDir, { recursive: true, force: true });
});

describe("Paseo preset pets", () => {
  it("provides three original, complete v1 SVG atlases", () => {
    expect(PASEO_PRESET_PETS.map((pet) => [pet.id, pet.source])).toEqual([
      ["paseo-orbit", "preset"],
      ["paseo-sprout", "preset"],
      ["paseo-ember", "preset"],
    ]);

    for (const pet of PASEO_PRESET_PETS) {
      const svg = getPresetPetSpritesheet(pet.id);
      expect(svg).toContain(`width="${PET_ATLAS_WIDTH}"`);
      expect(svg).toContain(`height="${V1_HEIGHT}"`);
      expect(svg?.match(/data-row="\d+" data-frame="\d+"/g)).toHaveLength(72);
    }
  });

  it("returns null for an unknown preset id", () => {
    expect(getPresetPetSpritesheet("codex")).toBeNull();
  });
});

describe("resolveCodexPetsDir", () => {
  it("honors CODEX_HOME and falls back to ~/.codex", () => {
    expect(resolveCodexPetsDir({ CODEX_HOME: "/custom/codex" })).toBe("/custom/codex/pets");
    expect(resolveCodexPetsDir({})).toMatch(/\.codex\/pets$/);
  });
});

describe("atlas metadata", () => {
  it("reads VP8X WebP and PNG dimensions", () => {
    expect(readWebpDimensions(makeWebp(PET_ATLAS_WIDTH, V1_HEIGHT))).toEqual({
      width: PET_ATLAS_WIDTH,
      height: V1_HEIGHT,
    });
    expect(readPngDimensions(makePng(PET_ATLAS_WIDTH, V2_HEIGHT))).toEqual({
      width: PET_ATLAS_WIDTH,
      height: V2_HEIGHT,
    });
    expect(readPetAtlasMetadata(makePng(PET_ATLAS_WIDTH, V2_HEIGHT))).toEqual({
      extension: "png",
      mimeType: "image/png",
      width: PET_ATLAS_WIDTH,
      height: V2_HEIGHT,
    });
  });

  it("returns null for non-image bytes", () => {
    expect(readPetAtlasMetadata(Buffer.from("not an image at all, really truly not"))).toBeNull();
  });
});

describe("resolveSpriteVersion", () => {
  it("maps atlas height to sprite version and row count", () => {
    expect(resolveSpriteVersion(V1_HEIGHT)).toEqual({ version: 1, rows: 9 });
    expect(resolveSpriteVersion(V2_HEIGHT)).toEqual({ version: 2, rows: 11 });
  });

  it("rejects an atlas height that matches no known version", () => {
    expect(resolveSpriteVersion(1000)).toBeNull();
  });
});

describe("parsePetManifest", () => {
  it("defaults spritesheetPath and falls back to the directory name for id", () => {
    const pet = parsePetManifest(JSON.stringify({ displayName: "Mofu" }), "mofu");
    expect(pet).toMatchObject({
      id: "mofu",
      displayName: "Mofu",
      spritesheetPath: "spritesheet.webp",
      source: "custom",
    });
  });

  it("rejects a spritesheetPath that escapes the pet directory", () => {
    expect(
      parsePetManifest(JSON.stringify({ spritesheetPath: "../../etc/passwd" }), "x"),
    ).toBeNull();
    expect(parsePetManifest(JSON.stringify({ spritesheetPath: "/etc/passwd" }), "x")).toBeNull();
  });

  it("returns null on malformed JSON", () => {
    expect(parsePetManifest("{nope", "x")).toBeNull();
  });
});

describe("listCodexPets", () => {
  it("returns Paseo presets when the custom-pet directory does not exist", async () => {
    await expect(listCodexPets(path.join(petsDir, "missing"))).resolves.toEqual(PASEO_PRESET_PETS);
  });

  it("lists sorted custom pets before presets and derives their versions", async () => {
    await writePet("mofu");
    await writePet("nova", { atlasHeight: V2_HEIGHT, format: "png" });

    const pets = await listCodexPets(petsDir);

    expect(pets.slice(0, 2).map((pet) => pet.id)).toEqual(["mofu", "nova"]);
    expect(pets.slice(2)).toEqual(PASEO_PRESET_PETS);
    expect(pets[0]).toMatchObject({ spriteVersionNumber: 1, rows: 9, source: "custom" });
    expect(pets[1]).toMatchObject({ spriteVersionNumber: 2, rows: 11, source: "custom" });
  });

  it("skips pets whose atlas dimensions are not recognized", async () => {
    await writePet("good");
    await writePet("wrong-height", { atlasHeight: 1234 });
    await writePet("wrong-width", { atlasWidth: 1000 });

    const ids = (await listCodexPets(petsDir)).map((pet) => pet.id);
    expect(ids).toContain("good");
    expect(ids).not.toContain("wrong-height");
    expect(ids).not.toContain("wrong-width");
  });

  it("skips a directory with no manifest and one with no spritesheet", async () => {
    await mkdir(path.join(petsDir, "empty"), { recursive: true });
    await writePet("sheetless", { atlasHeight: null });
    await writePet("good");

    const ids = (await listCodexPets(petsDir)).map((pet) => pet.id);
    expect(ids).toContain("good");
    expect(ids).not.toContain("empty");
    expect(ids).not.toContain("sheetless");
  });
});

describe("resolvePetSpritesheetPath", () => {
  it("resolves an installed pet's spritesheet", async () => {
    await writePet("mofu");
    await expect(resolvePetSpritesheetPath("mofu", petsDir)).resolves.toBe(
      await realpath(path.join(petsDir, "mofu", "spritesheet.webp")),
    );
  });

  it("refuses traversal, symlinks, and unknown pet ids", async () => {
    for (const id of ["../secrets", "a/b", "..", "", "nope"]) {
      await expect(resolvePetSpritesheetPath(id, petsDir)).resolves.toBeNull();
    }

    const external = path.join(petsDir, "external.webp");
    await writeFile(external, makeWebp(PET_ATLAS_WIDTH, V1_HEIGHT));
    const linkedDir = path.join(petsDir, "linked");
    await mkdir(linkedDir);
    await writeFile(
      path.join(linkedDir, "pet.json"),
      JSON.stringify({ displayName: "Linked", spritesheetPath: "spritesheet.webp" }),
    );
    await symlink(external, path.join(linkedDir, "spritesheet.webp"));
    await expect(resolvePetSpritesheetPath("linked", petsDir)).resolves.toBeNull();
  });
});

describe("custom pet import", () => {
  it("normalizes the id, derives a missing v1 version, and installs atomically", async () => {
    const pet = await importCodexPet(
      {
        manifest: { id: "  Mofu!!  ", displayName: "Mofu", description: "Soft cloud" },
        atlasBase64: makeWebp(PET_ATLAS_WIDTH, V1_HEIGHT).toString("base64"),
      },
      petsDir,
    );

    expect(pet).toMatchObject({
      id: "mofu",
      displayName: "Mofu",
      spriteVersionNumber: 1,
      rows: 9,
      source: "custom",
      spritesheetPath: "spritesheet.webp",
    });
    expect(JSON.parse(await readFile(path.join(petsDir, "mofu", "pet.json"), "utf8"))).toEqual({
      id: "mofu",
      displayName: "Mofu",
      description: "Soft cloud",
      spriteVersionNumber: 1,
      spritesheetPath: "spritesheet.webp",
    });
    expect((await readdir(petsDir)).some((entry) => entry.startsWith("."))).toBe(false);
  });

  it("supports v2 PNG atlases and allocates collision-safe ids", async () => {
    await writePet("nova");
    const pet = await importCodexPet(
      {
        manifest: { id: "nova", displayName: "Nova", spriteVersionNumber: 2 },
        atlasBase64: makePng(PET_ATLAS_WIDTH, V2_HEIGHT).toString("base64"),
      },
      petsDir,
    );
    expect(pet).toMatchObject({
      id: "nova-2",
      spriteVersionNumber: 2,
      rows: 11,
      spritesheetPath: "spritesheet.png",
    });

    const presetCollision = await importCodexPet(
      {
        manifest: { id: "paseo-orbit", displayName: "My Orbit" },
        atlasBase64: makeWebp(PET_ATLAS_WIDTH, V1_HEIGHT).toString("base64"),
      },
      petsDir,
    );
    expect(presetCollision.id).toBe("paseo-orbit-2");
  });

  it.each([
    {
      label: "wrong width",
      manifest: { displayName: "Bad" },
      atlas: makeWebp(1000, V1_HEIGHT),
      message: "width must be exactly",
    },
    {
      label: "wrong height",
      manifest: { displayName: "Bad" },
      atlas: makeWebp(PET_ATLAS_WIDTH, 1000),
      message: "height must be exactly",
    },
    {
      label: "version mismatch",
      manifest: { displayName: "Bad", spriteVersionNumber: 2 },
      atlas: makeWebp(PET_ATLAS_WIDTH, V1_HEIGHT),
      message: "does not match",
    },
  ])("rejects $label", async ({ manifest, atlas, message }) => {
    await expect(
      importCodexPet({ manifest, atlasBase64: atlas.toString("base64") }, petsDir),
    ).rejects.toThrow(message);
  });

  it("rejects malformed or oversized base64 before writing", async () => {
    await expect(
      importCodexPet({ manifest: { displayName: "Bad" }, atlasBase64: "not-base64" }, petsDir),
    ).rejects.toBeInstanceOf(PetImportError);

    const oversized = "A".repeat(Math.ceil(MAX_PET_ATLAS_BYTES / 3) * 4 + 4);
    await expect(
      importCodexPet({ manifest: { displayName: "Huge" }, atlasBase64: oversized }, petsDir),
    ).rejects.toMatchObject({ status: 413 });
    expect(await readdir(petsDir)).toEqual([]);
  });
});

describe("normalizePetId", () => {
  it("produces a bounded route-safe slug", () => {
    expect(normalizePetId("  Café Cloud / Pet  ")).toBe("cafe-cloud-pet");
    expect(normalizePetId("!!!")).toBe("pet");
    expect(normalizePetId("x".repeat(200))).toHaveLength(80);
  });
});
