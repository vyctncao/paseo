import { describe, expect, it } from "vitest";
import {
  projectDisplayNameFromProjectId,
  projectIconPlaceholderLabelFromDisplayName,
  sidebarProjectFolderName,
} from "./project-display-name";

describe("projectDisplayNameFromProjectId", () => {
  it("shows owner and repo for GitHub remote ids", () => {
    expect(projectDisplayNameFromProjectId("remote:github.com/getpaseo/paseo")).toBe(
      "getpaseo/paseo",
    );
  });

  it("shows the trailing directory name for local projects", () => {
    expect(projectDisplayNameFromProjectId("/Users/me/dev/paseo")).toBe("paseo");
  });
});

describe("projectIconPlaceholderLabelFromDisplayName", () => {
  it("uses repo name instead of owner for GitHub-style display names", () => {
    expect(projectIconPlaceholderLabelFromDisplayName("getpaseo/paseo")).toBe("paseo");
  });

  it("returns the original display name when it has no path separator", () => {
    expect(projectIconPlaceholderLabelFromDisplayName("paseo")).toBe("paseo");
  });
});

describe("sidebarProjectFolderName", () => {
  it.each([
    ["/Users/me/dev/paseo", "paseo"],
    ["/Users/me/dev/paseo///", "paseo"],
    ["C:\\Users\\me\\dev\\paseo", "paseo"],
    ["C:\\Users\\me\\dev\\paseo\\\\", "paseo"],
  ])("uses the cross-platform basename from %s", (projectRootPath, expected) => {
    expect(sidebarProjectFolderName(projectRootPath, "getpaseo/paseo")).toBe(expected);
  });

  it.each([undefined, null, "", "   ", "/", "C:\\"])(
    "falls back to the repository segment when the path is %s",
    (projectRootPath) => {
      expect(sidebarProjectFolderName(projectRootPath, "getpaseo/paseo")).toBe("paseo");
    },
  );

  it("keeps a plain fallback name unchanged", () => {
    expect(sidebarProjectFolderName(undefined, "paseo")).toBe("paseo");
  });
});
