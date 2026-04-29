import { describe, expect, it } from "vitest";
import {
  getAllAgents,
  getAllCodexSkills,
  getConfigTemplate,
} from "../../src/templates/codex/index.js";
import { resolveAllAsSkills } from "../../src/configurators/shared.js";
import { AI_TOOLS } from "../../src/types/ai-tools.js";

const EXPECTED_AGENT_NAMES = [
  "trellis-check",
  "trellis-implement",
  "trellis-research",
];

// Shared skills are now sourced from common/ via resolveAllAsSkills
describe("codex shared skills (from common source)", () => {
  it("resolves all common templates for codex context", () => {
    const skills = resolveAllAsSkills(AI_TOOLS.codex.templateContext);
    expect(skills.length).toBeGreaterThan(0);
    for (const skill of skills) {
      expect(skill.content).toContain("description:");
      expect(skill.content).toContain(`name: ${skill.name}`);
    }
  });

  it("does not include platform-specific syntax in resolved output", () => {
    const skills = resolveAllAsSkills(AI_TOOLS.codex.templateContext);
    for (const skill of skills) {
      // Codex uses $ prefix, not /trellis:
      expect(skill.content).not.toContain("/trellis:");
      expect(skill.content).not.toContain(".claude/");
      expect(skill.content).not.toContain(".cursor/");
    }
  });
});

describe("codex getAllAgents", () => {
  it("returns the expected custom agent set", () => {
    const agents = getAllAgents();
    const names = agents.map((agent) => agent.name);
    expect(names).toEqual(EXPECTED_AGENT_NAMES);
  });

  it("each agent has required fields (name, description, developer_instructions)", () => {
    for (const agent of getAllAgents()) {
      expect(agent.content.length).toBeGreaterThan(0);
      expect(agent.content).toContain("name = ");
      expect(agent.content).toContain("description = ");
      expect(agent.content).toContain("developer_instructions = ");
    }
  });
});

describe("codex getAllCodexSkills (platform-specific)", () => {
  it("returns empty after parallel removal", () => {
    const skills = getAllCodexSkills();
    expect(skills).toEqual([]);
  });
});

describe("codex getConfigTemplate", () => {
  it("returns project config.toml content", () => {
    const config = getConfigTemplate();
    expect(config.targetPath).toBe("config.toml");
    expect(config.content).toContain("project_doc_fallback_filenames");
    expect(config.content).toContain("AGENTS.md");
  });
});
