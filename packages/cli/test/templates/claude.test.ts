import { describe, expect, it } from "vitest";
import {
  settingsTemplate,
  getAllAgents,
  getSettingsTemplate,
} from "../../src/templates/claude/index.js";

// =============================================================================
// settingsTemplate — module-level constant
// =============================================================================

describe("settingsTemplate", () => {
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

describe("settingsTemplate SessionStart matchers", () => {
  const settings = JSON.parse(settingsTemplate);
  const sessionStartEntries = settings.hooks.SessionStart as {
    matcher: string;
    hooks: { type: string; command: string; timeout: number }[];
  }[];

  it("includes startup, clear, and compact matchers", () => {
    const matchers = sessionStartEntries.map((e) => e.matcher);
    expect(matchers).toContain("startup");
    expect(matchers).toContain("clear");
    expect(matchers).toContain("compact");
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
// getAllAgents — reads agent templates
// =============================================================================

describe("getAllAgents", () => {
  it("each agent has name and content", () => {
    const agents = getAllAgents();
    for (const agent of agents) {
      expect(agent.name.length).toBeGreaterThan(0);
      expect(agent.content.length).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// getSettingsTemplate — returns settings as SettingsTemplate
// =============================================================================

describe("getSettingsTemplate", () => {
  it("returns correct shape with valid JSON", () => {
    const result = getSettingsTemplate();
    expect(result.targetPath).toBe("settings.json");
    expect(result.content.length).toBeGreaterThan(0);
    expect(() => JSON.parse(result.content)).not.toThrow();
  });
});
