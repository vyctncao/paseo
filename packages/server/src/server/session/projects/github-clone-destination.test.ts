import { describe, expect, it } from "vitest";
import {
  CloneDestinationUnavailableError,
  InvalidGitHubRepositoryNameError,
  parseRepositoryCoordinates,
  resolveCloneDestination,
} from "./github-clone-destination.js";

interface FakeTreeOptions {
  directories?: Record<string, string | null>;
}

function fakeTree({ directories = {} }: FakeTreeOptions = {}) {
  return {
    directoryExists: (path: string) => Promise.resolve(path in directories),
    readGitHubRemote: (path: string) => Promise.resolve(directories[path] ?? null),
  };
}

describe("parseRepositoryCoordinates", () => {
  it("splits owner and name", () => {
    expect(parseRepositoryCoordinates("vyctncao/paseo")).toEqual({
      owner: "vyctncao",
      name: "paseo",
    });
  });

  it("rejects traversal segments that would escape the parent directory", () => {
    expect(() => parseRepositoryCoordinates("../../etc")).toThrow(InvalidGitHubRepositoryNameError);
    expect(() => parseRepositoryCoordinates("owner/..")).toThrow(InvalidGitHubRepositoryNameError);
    expect(() => parseRepositoryCoordinates("../name")).toThrow(InvalidGitHubRepositoryNameError);
  });

  it("rejects names that are not exactly owner/name", () => {
    expect(() => parseRepositoryCoordinates("paseo")).toThrow(InvalidGitHubRepositoryNameError);
    expect(() => parseRepositoryCoordinates("a/b/c")).toThrow(InvalidGitHubRepositoryNameError);
    expect(() => parseRepositoryCoordinates("")).toThrow(InvalidGitHubRepositoryNameError);
  });

  it("rejects separators smuggled into a segment", () => {
    expect(() => parseRepositoryCoordinates("owner/na me")).toThrow(
      InvalidGitHubRepositoryNameError,
    );
    expect(() => parseRepositoryCoordinates("owner/na\\me")).toThrow(
      InvalidGitHubRepositoryNameError,
    );
  });
});

describe("resolveCloneDestination", () => {
  it("clones into the repository name when nothing is there", async () => {
    await expect(
      resolveCloneDestination({
        nameWithOwner: "vyctncao/paseo",
        parentDirectory: "/home/yoni",
        ...fakeTree(),
      }),
    ).resolves.toEqual({ kind: "clone", path: "/home/yoni/paseo" });
  });

  it("reuses an existing checkout of the same repository instead of cloning twice", async () => {
    await expect(
      resolveCloneDestination({
        nameWithOwner: "vyctncao/paseo",
        parentDirectory: "/home/yoni",
        ...fakeTree({ directories: { "/home/yoni/paseo": "vyctncao/paseo" } }),
      }),
    ).resolves.toEqual({ kind: "reuse", path: "/home/yoni/paseo" });
  });

  it("matches an existing checkout case-insensitively", async () => {
    await expect(
      resolveCloneDestination({
        nameWithOwner: "VyctnCao/Paseo",
        parentDirectory: "/home/yoni",
        ...fakeTree({ directories: { "/home/yoni/Paseo": "vyctncao/paseo" } }),
      }),
    ).resolves.toEqual({ kind: "reuse", path: "/home/yoni/Paseo" });
  });

  it("suffixes past an unrelated directory that already owns the name", async () => {
    await expect(
      resolveCloneDestination({
        nameWithOwner: "vyctncao/paseo",
        parentDirectory: "/home/yoni",
        ...fakeTree({ directories: { "/home/yoni/paseo": "someone-else/paseo" } }),
      }),
    ).resolves.toEqual({ kind: "clone", path: "/home/yoni/paseo-2" });
  });

  it("suffixes past a non-git directory that already owns the name", async () => {
    await expect(
      resolveCloneDestination({
        nameWithOwner: "vyctncao/paseo",
        parentDirectory: "/home/yoni",
        ...fakeTree({ directories: { "/home/yoni/paseo": null } }),
      }),
    ).resolves.toEqual({ kind: "clone", path: "/home/yoni/paseo-2" });
  });

  it("keeps counting suffixes until a free name appears", async () => {
    await expect(
      resolveCloneDestination({
        nameWithOwner: "vyctncao/paseo",
        parentDirectory: "/home/yoni",
        ...fakeTree({
          directories: {
            "/home/yoni/paseo": null,
            "/home/yoni/paseo-2": null,
            "/home/yoni/paseo-3": null,
          },
        }),
      }),
    ).resolves.toEqual({ kind: "clone", path: "/home/yoni/paseo-4" });
  });

  it("prefers reusing a suffixed checkout of the same repository over cloning again", async () => {
    await expect(
      resolveCloneDestination({
        nameWithOwner: "vyctncao/paseo",
        parentDirectory: "/home/yoni",
        ...fakeTree({
          directories: {
            "/home/yoni/paseo": "someone-else/paseo",
            "/home/yoni/paseo-2": "vyctncao/paseo",
          },
        }),
      }),
    ).resolves.toEqual({ kind: "reuse", path: "/home/yoni/paseo-2" });
  });

  it("gives up rather than looping forever when every name is taken", async () => {
    const directories: Record<string, string | null> = { "/home/yoni/paseo": null };
    for (let index = 2; index <= 200; index += 1) {
      directories[`/home/yoni/paseo-${index}`] = null;
    }

    await expect(
      resolveCloneDestination({
        nameWithOwner: "vyctncao/paseo",
        parentDirectory: "/home/yoni",
        ...fakeTree({ directories }),
      }),
    ).rejects.toThrow(CloneDestinationUnavailableError);
  });
});
