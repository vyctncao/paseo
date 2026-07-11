import { describe, expect, it } from "vitest";
import {
  fetchCodexPets,
  importCodexPet,
  resolveCodexPet,
  type CodexPetSummary,
} from "./use-codex-pets";

const pets: CodexPetSummary[] = [
  { id: "mofu", displayName: "Mofu", spriteVersionNumber: 1, rows: 9, source: "custom" },
  { id: "paseo-orbit", displayName: "Orbit", spriteVersionNumber: 1, rows: 9, source: "preset" },
];

describe("fetchCodexPets", () => {
  it("keeps an unavailable or unauthorized catalog distinct from an empty catalog", async () => {
    const fetchImpl = async (): Promise<Response> => new Response(null, { status: 401 });

    await expect(
      fetchCodexPets("http://127.0.0.1:6768", { fetchImpl: fetchImpl as typeof fetch }),
    ).rejects.toThrow("Pet catalog request failed with status 401");
  });

  it("sends the daemon bearer header when one is configured", async () => {
    let authorization: string | null = null;
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      authorization = new Headers(init?.headers).get("Authorization");
      return Response.json({ pets });
    };

    await expect(
      fetchCodexPets("http://127.0.0.1:6768", {
        authHeader: "Bearer secret",
        fetchImpl: fetchImpl as typeof fetch,
      }),
    ).resolves.toEqual(pets);
    expect(authorization).toBe("Bearer secret");
  });
});

describe("importCodexPet", () => {
  it("posts the manifest and atlas, authenticates, and returns the normalized pet", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const imported: CodexPetSummary = {
      id: "mofu-2",
      displayName: "Mofu",
      spriteVersionNumber: 1,
      rows: 9,
      source: "custom",
    };
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedUrl = String(input);
      capturedInit = init;
      return Response.json({ pet: imported }, { status: 201 });
    };
    const input = {
      manifest: { id: "Mofu", displayName: "Mofu" },
      atlasBase64: "UklGRg==",
    };

    await expect(
      importCodexPet("http://127.0.0.1:6768", input, {
        authHeader: "Bearer secret",
        fetchImpl: fetchImpl as typeof fetch,
      }),
    ).resolves.toEqual(imported);
    expect(capturedUrl).toBe("http://127.0.0.1:6768/api/pets/import");
    expect(capturedInit?.method).toBe("POST");
    expect(new Headers(capturedInit?.headers).get("Authorization")).toBe("Bearer secret");
    expect(JSON.parse(String(capturedInit?.body))).toEqual(input);
  });

  it("reports a rejected import and a malformed success response", async () => {
    const rejectedFetch = async (): Promise<Response> => new Response(null, { status: 413 });
    await expect(
      importCodexPet(
        "http://127.0.0.1:6768",
        { manifest: { displayName: "Huge" }, atlasBase64: "AAAA" },
        { fetchImpl: rejectedFetch as typeof fetch },
      ),
    ).rejects.toThrow("Pet import failed with status 413");

    const malformedFetch = async (): Promise<Response> => Response.json({});
    await expect(
      importCodexPet(
        "http://127.0.0.1:6768",
        { manifest: { displayName: "Missing" }, atlasBase64: "AAAA" },
        { fetchImpl: malformedFetch as typeof fetch },
      ),
    ).rejects.toThrow("did not include a pet");
  });
});

describe("resolveCodexPet", () => {
  it("resolves the saved pet when that pet is installed", () => {
    expect(
      resolveCodexPet({
        baseUrl: "http://127.0.0.1:6768",
        pets,
        petId: "paseo-orbit",
      }),
    ).toEqual({
      id: "paseo-orbit",
      displayName: "Orbit",
      spritesheetUrl: "http://127.0.0.1:6768/api/pets/paseo-orbit/spritesheet",
      rows: 9,
      source: "preset",
    });
  });

  it("returns null when the requested pet is unavailable", () => {
    expect(
      resolveCodexPet({
        baseUrl: "http://127.0.0.1:6768",
        pets,
        petId: "other-host-only",
      }),
    ).toBeNull();
  });

  it("returns null without an HTTP host or installed pets", () => {
    expect(resolveCodexPet({ baseUrl: null, pets, petId: "mofu" })).toBeNull();
    expect(
      resolveCodexPet({
        baseUrl: "http://127.0.0.1:6768",
        pets: [],
        petId: "mofu",
      }),
    ).toBeNull();
  });
});
