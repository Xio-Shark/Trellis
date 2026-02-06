import { describe, expect, it } from "vitest";
import {
  AI_TOOLS,
  type AITool,
  getTemplateDirs,
  getToolConfig,
} from "../../src/types/ai-tools.js";

const ALL_TOOL_IDS = Object.keys(AI_TOOLS) as AITool[];

// =============================================================================
// getToolConfig
// =============================================================================

describe("getToolConfig", () => {
  it("returns the correct config for each platform", () => {
    for (const id of ALL_TOOL_IDS) {
      const config = getToolConfig(id);
      expect(config).toBe(AI_TOOLS[id]);
    }
  });

  it("returned config has all required fields", () => {
    for (const id of ALL_TOOL_IDS) {
      const config = getToolConfig(id);
      expect(config).toHaveProperty("name");
      expect(config).toHaveProperty("templateDirs");
      expect(config).toHaveProperty("configDir");
      expect(config).toHaveProperty("cliFlag");
      expect(config).toHaveProperty("defaultChecked");
      expect(config).toHaveProperty("hasPythonHooks");
    }
  });
});

// =============================================================================
// getTemplateDirs
// =============================================================================

describe("getTemplateDirs", () => {
  it("returns the correct template dirs for each platform", () => {
    for (const id of ALL_TOOL_IDS) {
      const dirs = getTemplateDirs(id);
      expect(dirs).toEqual(AI_TOOLS[id].templateDirs);
    }
  });

  it("every platform includes common templates", () => {
    for (const id of ALL_TOOL_IDS) {
      const dirs = getTemplateDirs(id);
      expect(dirs).toContain("common");
    }
  });
});
