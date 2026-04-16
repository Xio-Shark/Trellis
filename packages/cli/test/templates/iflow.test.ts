import { describe, expect, it } from "vitest";
import {
  settingsTemplate,
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
// settingsTemplate — SessionStart hook matchers
// =============================================================================

describe("iflow settingsTemplate SessionStart matchers", () => {
  const settings = JSON.parse(settingsTemplate);
  const sessionStartEntries = settings.hooks.SessionStart as {
    matcher: string;
    hooks: { type: string; command: string; timeout: number }[];
  }[];

  it("includes startup, clear, and compress matchers", () => {
    const matchers = sessionStartEntries.map((e) => e.matcher);
    expect(matchers).toContain("startup");
    expect(matchers).toContain("clear");
    expect(matchers).toContain("compress");
  });

  it("all SessionStart entries invoke the same session-start.py hook", () => {
    for (const entry of sessionStartEntries) {
      expect(entry.hooks).toHaveLength(1);
      expect(entry.hooks[0].command).toContain("session-start.py");
    }
  });

  it("all SessionStart entries use {{PYTHON_CMD}} placeholder", () => {
    for (const entry of sessionStartEntries) {
      expect(entry.hooks[0].command).toContain("{{PYTHON_CMD}}");
    }
  });
});

// Commands are now sourced from common/ templates and tested in platforms.test.ts

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
