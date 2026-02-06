import { describe, expect, it } from "vitest";
import {
  settingsTemplate,
  getAllCommands,
  getAllAgents,
  getAllHooks,
  getSettingsTemplate,
} from "../../src/templates/iflow/index.js";

// =============================================================================
// settingsTemplate — module-level constant
// =============================================================================

describe("iflow settingsTemplate", () => {
  it("is valid JSON", () => {
    expect(() => JSON.parse(settingsTemplate)).not.toThrow();
  });

  it("is a non-empty string", () => {
    expect(typeof settingsTemplate).toBe("string");
    expect(settingsTemplate.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// getAllCommands — reads iflow command templates
// =============================================================================

describe("iflow getAllCommands", () => {
  it("returns an array", () => {
    const commands = getAllCommands();
    expect(Array.isArray(commands)).toBe(true);
  });

  it("returns empty list (commands are in trellis/ subdirectory, not listed by getAllCommands)", () => {
    // iflow getAllCommands lists commands/ top-level only, but actual .md files are in commands/trellis/
    const commands = getAllCommands();
    expect(commands.length).toBe(0);
  });

  it("each command has name and content", () => {
    const commands = getAllCommands();
    for (const cmd of commands) {
      expect(typeof cmd.name).toBe("string");
      expect(cmd.name.length).toBeGreaterThan(0);
      expect(typeof cmd.content).toBe("string");
      expect(cmd.content.length).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// getAllAgents — reads iflow agent templates
// =============================================================================

describe("iflow getAllAgents", () => {
  it("returns an array", () => {
    const agents = getAllAgents();
    expect(Array.isArray(agents)).toBe(true);
  });

  it("each agent has name and content", () => {
    const agents = getAllAgents();
    for (const agent of agents) {
      expect(typeof agent.name).toBe("string");
      expect(agent.name.length).toBeGreaterThan(0);
      expect(typeof agent.content).toBe("string");
      expect(agent.content.length).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// getAllHooks — reads iflow hook templates
// =============================================================================

describe("iflow getAllHooks", () => {
  it("returns an array", () => {
    const hooks = getAllHooks();
    expect(Array.isArray(hooks)).toBe(true);
  });

  it("each hook has targetPath starting with hooks/ and content", () => {
    const hooks = getAllHooks();
    for (const hook of hooks) {
      expect(typeof hook.targetPath).toBe("string");
      expect(hook.targetPath.startsWith("hooks/")).toBe(true);
      expect(typeof hook.content).toBe("string");
      expect(hook.content.length).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// getSettingsTemplate
// =============================================================================

describe("iflow getSettingsTemplate", () => {
  it("returns correct shape", () => {
    const result = getSettingsTemplate();
    expect(result.targetPath).toBe("settings.json");
    expect(typeof result.content).toBe("string");
  });

  it("content matches settingsTemplate constant", () => {
    const result = getSettingsTemplate();
    expect(result.content).toBe(settingsTemplate);
  });
});
