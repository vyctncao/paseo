import { afterEach, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { hashDaemonPassword } from "../auth.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { PET_ATLAS_WIDTH, PET_CELL_HEIGHT, PET_STATES_V1 } from "./codex-pets.js";

function makeUploadWebp(): Buffer {
  // Larger than Express's default 100 KiB once base64 encoded, proving the
  // import-only parser limit is mounted before the global JSON parser.
  const buffer = Buffer.alloc(150 * 1024);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8X", 12, "ascii");
  buffer.writeUInt32LE(10, 16);
  const width = PET_ATLAS_WIDTH - 1;
  const height = PET_STATES_V1.length * PET_CELL_HEIGHT - 1;
  buffer[24] = width & 0xff;
  buffer[25] = (width >> 8) & 0xff;
  buffer[26] = (width >> 16) & 0xff;
  buffer[27] = height & 0xff;
  buffer[28] = (height >> 8) & 0xff;
  buffer[29] = (height >> 16) & 0xff;
  return buffer;
}

describe("pet REST API", () => {
  let daemon: TestPaseoDaemon | null = null;
  let codexHome: string | null = null;
  const previousCodexHome = process.env.CODEX_HOME;

  afterEach(async () => {
    await daemon?.close();
    daemon = null;
    if (codexHome) await rm(codexHome, { recursive: true, force: true });
    codexHome = null;
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
  });

  test("authenticates, imports a large JSON atlas, lists it, and serves presets", async () => {
    codexHome = await mkdtemp(path.join(tmpdir(), "paseo-codex-home-"));
    process.env.CODEX_HOME = codexHome;
    daemon = await createTestPaseoDaemon({
      auth: { password: hashDaemonPassword("pet-secret") },
    });
    const baseUrl = `http://127.0.0.1:${daemon.port}`;
    const body = JSON.stringify({
      manifest: { id: "My Pet", displayName: "My Pet" },
      atlasBase64: makeUploadWebp().toString("base64"),
    });

    const unauthorized = await fetch(`${baseUrl}/api/pets/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    expect(unauthorized.status).toBe(401);

    const authorization = { Authorization: "Bearer pet-secret" };
    const imported = await fetch(`${baseUrl}/api/pets/import`, {
      method: "POST",
      headers: { ...authorization, "Content-Type": "application/json" },
      body,
    });
    expect(imported.status).toBe(201);
    await expect(imported.json()).resolves.toMatchObject({
      pet: { id: "my-pet", source: "custom", spriteVersionNumber: 1 },
    });

    const catalog = await fetch(`${baseUrl}/api/pets`, { headers: authorization });
    const catalogBody = (await catalog.json()) as { pets: Array<{ id: string; source: string }> };
    expect(catalogBody.pets.map((pet) => pet.id)).toEqual([
      "my-pet",
      "paseo-orbit",
      "paseo-sprout",
      "paseo-ember",
    ]);

    const preset = await fetch(`${baseUrl}/api/pets/paseo-orbit/spritesheet`, {
      headers: authorization,
    });
    expect(preset.status).toBe(200);
    expect(preset.headers.get("content-type")).toContain("image/svg+xml");
    expect(await preset.text()).toContain(`width="${PET_ATLAS_WIDTH}"`);
  });
});
