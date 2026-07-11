import { describe, expect, it } from "vitest";
import {
  ADD_PROJECT_OPTION_ID,
  NO_PROJECT_OPTION_ID,
  appendAddProjectOption,
  appendNoProjectOption,
  isAddProjectOption,
  isNoProjectOption,
} from "./project-picker";

describe("new workspace project picker actions", () => {
  it("appends Add project after registered projects", () => {
    const options = [{ id: "project:existing", label: "Existing" }];

    expect(appendAddProjectOption(options, "Add project")).toEqual([
      ...options,
      { id: ADD_PROJECT_OPTION_ID, label: "Add project" },
    ]);
    expect(options).toEqual([{ id: "project:existing", label: "Existing" }]);
  });

  it("recognizes only the Add project action", () => {
    expect(isAddProjectOption(ADD_PROJECT_OPTION_ID)).toBe(true);
    expect(isAddProjectOption(NO_PROJECT_OPTION_ID)).toBe(false);
    expect(isAddProjectOption("project:existing")).toBe(false);
  });

  it("appends and recognizes the no-project action", () => {
    const options = appendAddProjectOption([], "Add project");

    expect(appendNoProjectOption(options, "Don't work in a project")).toEqual([
      { id: ADD_PROJECT_OPTION_ID, label: "Add project" },
      { id: NO_PROJECT_OPTION_ID, label: "Don't work in a project" },
    ]);
    expect(isNoProjectOption(NO_PROJECT_OPTION_ID)).toBe(true);
    expect(isNoProjectOption(ADD_PROJECT_OPTION_ID)).toBe(false);
    expect(isNoProjectOption("project:existing")).toBe(false);
  });
});
