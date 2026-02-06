/**
 * Registry Invariant Tests
 *
 * Cross-module consistency checks inspired by:
 * - SQLite's invariant checking (PRAGMA integrity_check after every operation)
 * - Mark Seemann's DI container testing (roundtrip + consumer-perspective checks)
 *
 * These tests catch errors when adding a new platform but forgetting to update
 * one of the registries or derived data.
 */

import { describe, expect, it } from "vitest";
import { AI_TOOLS } from "../src/types/ai-tools.js";
import {
  ALL_MANAGED_DIRS,
  CONFIG_DIRS,
  PLATFORM_IDS,
  collectPlatformTemplates,
  getInitToolChoices,
  getPlatformsWithPythonHooks,
  resolveCliFlag,
} from "../src/configurators/index.js";

const COMMANDER_RESERVED_FLAGS = ["help", "version", "V", "h"];

// =============================================================================
// Internal Consistency (SQLite-style invariant checks)
// =============================================================================

describe("registry internal consistency", () => {
  it("PLATFORM_IDS length matches AI_TOOLS keys", () => {
    expect(PLATFORM_IDS.length).toBe(Object.keys(AI_TOOLS).length);
  });

  it("all cliFlag values are unique", () => {
    const flags = PLATFORM_IDS.map((id) => AI_TOOLS[id].cliFlag);
    const unique = new Set(flags);
    expect(unique.size).toBe(flags.length);
  });

  it("all configDir values are unique", () => {
    const dirs = PLATFORM_IDS.map((id) => AI_TOOLS[id].configDir);
    const unique = new Set(dirs);
    expect(unique.size).toBe(dirs.length);
  });

  it("all configDir values start with dot", () => {
    for (const id of PLATFORM_IDS) {
      expect(AI_TOOLS[id].configDir.startsWith(".")).toBe(true);
    }
  });

  it("no configDir collides with .trellis", () => {
    for (const id of PLATFORM_IDS) {
      expect(AI_TOOLS[id].configDir).not.toBe(".trellis");
    }
  });

  it("no cliFlag collides with commander.js reserved flags", () => {
    for (const id of PLATFORM_IDS) {
      expect(COMMANDER_RESERVED_FLAGS).not.toContain(AI_TOOLS[id].cliFlag);
    }
  });

  it("every platform has non-empty name", () => {
    for (const id of PLATFORM_IDS) {
      expect(AI_TOOLS[id].name.length).toBeGreaterThan(0);
    }
  });

  it("every platform templateDirs includes common", () => {
    for (const id of PLATFORM_IDS) {
      expect(AI_TOOLS[id].templateDirs).toContain("common");
    }
  });

  it("ALL_MANAGED_DIRS has no duplicates", () => {
    const unique = new Set(ALL_MANAGED_DIRS);
    expect(unique.size).toBe(ALL_MANAGED_DIRS.length);
  });

  it("ALL_MANAGED_DIRS starts with .trellis", () => {
    expect(ALL_MANAGED_DIRS[0]).toBe(".trellis");
  });

  it("CONFIG_DIRS is ordered mapping of AI_TOOLS configDir", () => {
    for (let i = 0; i < PLATFORM_IDS.length; i++) {
      expect(CONFIG_DIRS[i]).toBe(AI_TOOLS[PLATFORM_IDS[i]].configDir);
    }
  });
});

// =============================================================================
// Roundtrip Consistency (Seemann consumer-perspective checks)
// =============================================================================

describe("registry roundtrip consistency", () => {
  it("resolveCliFlag roundtrips for all platforms", () => {
    for (const id of PLATFORM_IDS) {
      const flag = AI_TOOLS[id].cliFlag;
      expect(resolveCliFlag(flag)).toBe(id);
    }
  });

  it("getInitToolChoices keys all resolve back to platformId", () => {
    const choices = getInitToolChoices();
    for (const choice of choices) {
      expect(resolveCliFlag(choice.key)).toBe(choice.platformId);
    }
  });

  it("getInitToolChoices covers all platforms", () => {
    const choices = getInitToolChoices();
    const platformIds = choices.map((c) => c.platformId);
    expect(platformIds).toEqual(expect.arrayContaining(PLATFORM_IDS));
    expect(platformIds).toHaveLength(PLATFORM_IDS.length);
  });

  it("collectPlatformTemplates does not throw for any platform", () => {
    for (const id of PLATFORM_IDS) {
      expect(() => collectPlatformTemplates(id)).not.toThrow();
    }
  });

  it("collectPlatformTemplates paths belong to owning platform", () => {
    for (const id of PLATFORM_IDS) {
      const templates = collectPlatformTemplates(id);
      if (templates) {
        const configDir = AI_TOOLS[id].configDir;
        for (const [filePath] of templates) {
          expect(filePath.startsWith(configDir + "/")).toBe(true);
        }
      }
    }
  });

  it("getPlatformsWithPythonHooks is a subset of PLATFORM_IDS", () => {
    const hooks = getPlatformsWithPythonHooks();
    for (const id of hooks) {
      expect(PLATFORM_IDS).toContain(id);
    }
  });
});
