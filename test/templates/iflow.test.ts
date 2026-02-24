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
    expect(settingsTemplate.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// getAllCommands — reads iflow command templates
// =============================================================================

const EXPECTED_COMMAND_NAMES = [
  "before-backend-dev",
  "before-frontend-dev",
  "brainstorm",
  "break-loop",
  "check-backend",
  "check-cross-layer",
  "check-frontend",
  "create-command",
  "finish-work",
  "integrate-skill",
  "onboard",
  "parallel",
  "record-session",
  "start",
  "update-spec",
];

describe("iflow getAllCommands", () => {
  it("returns the expected command set", () => {
    const commands = getAllCommands();
    const names = commands.map((c) => c.name);
    expect(names).toEqual(EXPECTED_COMMAND_NAMES);
  });

  it("each command has name and content", () => {
    const commands = getAllCommands();
    for (const command of commands) {
      expect(command.name.length).toBeGreaterThan(0);
      expect(command.content.length).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// getAllAgents — reads iflow agent templates
// =============================================================================

describe("iflow getAllAgents", () => {
  it("each agent has name and content", () => {
    const agents = getAllAgents();
    for (const agent of agents) {
      expect(agent.name.length).toBeGreaterThan(0);
      expect(agent.content.length).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// getAllHooks — reads iflow hook templates
// =============================================================================

describe("iflow getAllHooks", () => {
  it("each hook has targetPath starting with hooks/ and content", () => {
    const hooks = getAllHooks();
    for (const hook of hooks) {
      expect(hook.targetPath.startsWith("hooks/")).toBe(true);
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
    expect(result.content.length).toBeGreaterThan(0);
  });
});
