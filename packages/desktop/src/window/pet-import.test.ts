import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readDesktopPetImport } from "./pet-import";

describe("readDesktopPetImport", () => {
  const directories = new Set<string>();

  async function makeDirectory(): Promise<string> {
    const directory = await mkdtemp(path.join(os.tmpdir(), "paseo-pet-import-"));
    directories.add(directory);
    return directory;
  }

  afterEach(async () => {
    await Promise.all(
      [...directories].map((directory) => rm(directory, { recursive: true, force: true })),
    );
    directories.clear();
  });

  it("reads a manifest and its referenced WebP spritesheet", async () => {
    const directory = await makeDirectory();
    const image = Buffer.from([0, 1, 2, 3]);
    await writeFile(
      path.join(directory, "pet.json"),
      JSON.stringify({ displayName: "Mofu", spritesheetPath: "art/mofu.webp" }),
    );
    await mkdir(path.join(directory, "art"));
    await writeFile(path.join(directory, "art/mofu.webp"), image);

    await expect(readDesktopPetImport(directory)).resolves.toEqual({
      manifestText: JSON.stringify({ displayName: "Mofu", spritesheetPath: "art/mofu.webp" }),
      spritesheetBase64: image.toString("base64"),
      fileName: "mofu.webp",
    });
  });

  it("uses spritesheet.webp when the manifest omits spritesheetPath", async () => {
    const directory = await makeDirectory();
    await writeFile(path.join(directory, "pet.json"), JSON.stringify({ displayName: "Mofu" }));
    await writeFile(path.join(directory, "spritesheet.webp"), Buffer.from("sheet"));

    const result = await readDesktopPetImport(directory);
    expect(result.fileName).toBe("spritesheet.webp");
  });

  it("rejects unsupported image types", async () => {
    const directory = await makeDirectory();
    await writeFile(
      path.join(directory, "pet.json"),
      JSON.stringify({ spritesheetPath: "sheet.svg" }),
    );
    await writeFile(path.join(directory, "sheet.svg"), "<svg />");

    await expect(readDesktopPetImport(directory)).rejects.toThrow("PNG or WebP");
  });

  it("rejects spritesheet traversal", async () => {
    const root = await makeDirectory();
    const directory = path.join(root, "pet");
    await mkdir(directory);
    await writeFile(
      path.join(directory, "pet.json"),
      JSON.stringify({ spritesheetPath: "../x.png" }),
    );
    await writeFile(path.join(root, "x.png"), "x");

    await expect(readDesktopPetImport(directory)).rejects.toThrow("not safe");
  });

  it("rejects a spritesheet symlink that escapes the selected folder", async () => {
    const root = await makeDirectory();
    const directory = path.join(root, "pet");
    await mkdir(directory);
    await writeFile(
      path.join(directory, "pet.json"),
      JSON.stringify({ spritesheetPath: "sheet.png" }),
    );
    await writeFile(path.join(root, "outside.png"), "outside");
    await symlink(path.join(root, "outside.png"), path.join(directory, "sheet.png"));

    await expect(readDesktopPetImport(directory)).rejects.toThrow("inside the selected folder");
  });

  it("rejects spritesheets larger than the host import limit", async () => {
    const directory = await makeDirectory();
    await writeFile(
      path.join(directory, "pet.json"),
      JSON.stringify({ spritesheetPath: "sheet.webp" }),
    );
    await writeFile(path.join(directory, "sheet.webp"), Buffer.alloc(8 * 1024 * 1024 + 1));

    await expect(readDesktopPetImport(directory)).rejects.toThrow("too large");
  });
});
