import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  listCodexPets,
  parsePetManifest,
  PET_CELL_HEIGHT,
  PET_STATES_V1,
  readWebpDimensions,
  resolveCodexPetsDir,
  resolvePetSpritesheetPath,
  resolveSpriteVersion,
} from "./codex-pets.js";

/** Minimal VP8X-chunk WebP header. Only the dimension fields are meaningful. */
function makeWebp(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(32);
  buffer.write("RIFF", 0, "ascii");
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8X", 12, "ascii");
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

const V1_HEIGHT = PET_STATES_V1.length * PET_CELL_HEIGHT; // 1872
const V2_HEIGHT = 11 * PET_CELL_HEIGHT; // 2288

let petsDir: string;

async function writePet(
  id: string,
  options: { manifest?: string; atlasHeight?: number | null } = {},
): Promise<void> {
  const dir = path.join(petsDir, id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "pet.json"),
    options.manifest ??
      JSON.stringify({
        id,
        displayName: id,
        description: "d",
        spritesheetPath: "spritesheet.webp",
      }),
  );
  if (options.atlasHeight !== null) {
    await writeFile(
      path.join(dir, "spritesheet.webp"),
      makeWebp(1536, options.atlasHeight ?? V1_HEIGHT),
    );
  }
}

beforeEach(async () => {
  petsDir = await mkdtemp(path.join(tmpdir(), "paseo-pets-"));
});

afterEach(async () => {
  await rm(petsDir, { recursive: true, force: true });
});

describe("resolveCodexPetsDir", () => {
  it("honors CODEX_HOME and falls back to ~/.codex", () => {
    expect(resolveCodexPetsDir({ CODEX_HOME: "/custom/codex" })).toBe("/custom/codex/pets");
    expect(resolveCodexPetsDir({})).toMatch(/\.codex\/pets$/);
  });
});

describe("readWebpDimensions", () => {
  it("reads VP8X dimensions", () => {
    expect(readWebpDimensions(makeWebp(1536, V1_HEIGHT))).toEqual({
      width: 1536,
      height: V1_HEIGHT,
    });
  });

  it("returns null for non-WebP bytes", () => {
    expect(readWebpDimensions(Buffer.from("not an image at all, really truly not"))).toBeNull();
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
  it("returns [] when the pets directory does not exist", async () => {
    await expect(listCodexPets(path.join(petsDir, "missing"))).resolves.toEqual([]);
  });

  it("lists installed pets with their derived sprite version", async () => {
    await writePet("mofu");
    await writePet("nova", { atlasHeight: V2_HEIGHT });

    const pets = await listCodexPets(petsDir);

    expect(pets.map((pet) => pet.id)).toEqual(["mofu", "nova"]);
    expect(pets[0]).toMatchObject({ spriteVersionNumber: 1, rows: 9 });
    expect(pets[1]).toMatchObject({ spriteVersionNumber: 2, rows: 11 });
  });

  it("skips pets whose atlas is not a recognized size", async () => {
    await writePet("good");
    await writePet("weird", { atlasHeight: 1234 });

    expect((await listCodexPets(petsDir)).map((pet) => pet.id)).toEqual(["good"]);
  });

  it("skips a directory with no manifest and one with no spritesheet", async () => {
    await mkdir(path.join(petsDir, "empty"), { recursive: true });
    await writePet("sheetless", { atlasHeight: null });
    await writePet("good");

    expect((await listCodexPets(petsDir)).map((pet) => pet.id)).toEqual(["good"]);
  });
});

describe("resolvePetSpritesheetPath", () => {
  it("resolves an installed pet's spritesheet", async () => {
    await writePet("mofu");
    await expect(resolvePetSpritesheetPath("mofu", petsDir)).resolves.toBe(
      path.join(petsDir, "mofu", "spritesheet.webp"),
    );
  });

  it("refuses path traversal in the pet id", async () => {
    for (const id of ["../secrets", "a/b", "..", ""]) {
      await expect(resolvePetSpritesheetPath(id, petsDir)).resolves.toBeNull();
    }
  });

  it("returns null for an unknown pet", async () => {
    await expect(resolvePetSpritesheetPath("nope", petsDir)).resolves.toBeNull();
  });
});
